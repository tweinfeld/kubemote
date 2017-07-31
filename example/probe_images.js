const
    _ = require('lodash'),
    fs = require('fs'),
    Kubemote = require('../src/kubemote'),
    kefir = require('kefir'),
    uuid = require('uuid');

let
    remote = new Kubemote({ type: "home_dir" }),
    probeStream = kefir
        .fromPromise(remote.getNodes())
        .map((podList)=> _(podList["items"]).map('metadata.name').uniq().value())
        .flatMap((nodeNameList)=> {
            console.log('Processing %d nodes..', nodeNameList.length);
            return kefir.combine(
                nodeNameList.map((nodeName)=> {
                    let jobName = _(uuid.v4()).split('-').first();
                    return kefir
                        .concat([
                            kefir.fromPromise(remote.createJob({
                                    "apiVersion": "batch/v1",
                                    "kind": "Job",
                                    "metadata": {
                                        "name": jobName
                                    },
                                    "spec": {
                                        "activeDeadlineSeconds": 3600,
                                        "template": {
                                            "metadata": {
                                                "name": "probe"
                                            },
                                            "spec": {
                                                "containers": [
                                                    {
                                                        "command": ["/bin/sh"],
                                                        "args": ["-c", "docker inspect $(docker images --no-trunc -aq)"],
                                                        "image": "docker:17.03",
                                                        "env": [{
                                                            "name": "DOCKER_API_VERSION",
                                                            "value": "1.23"
                                                        }],
                                                        "imagePullPolicy": "IfNotPresent",
                                                        "name": "probe",
                                                        "resources": {},
                                                        "volumeMounts": [
                                                            {
                                                                "mountPath": "/var/run",
                                                                "name": "docker-sock"
                                                            }
                                                        ]
                                                    }
                                                ],
                                                nodeName,
                                                "restartPolicy": "Never",
                                                "volumes": [
                                                    {
                                                        "name": "docker-sock",
                                                        "hostPath": {
                                                            "path": "/var/run"
                                                        }
                                                    }
                                                ]
                                            }
                                        }

                                    }
                                }
                            )).ignoreValues(),
                            kefir.fromPromise(remote.watchJob({ jobName })).flatMap((stopWatch)=>{
                                let stream = kefir
                                    .fromEvents(remote, 'watch')
                                    .filter(_.matches({ object: { kind: "Job", metadata: { name: jobName }} }))
                                    .filter((watchNotification)=> _.get(watchNotification, 'object.status.completionTime'))
                                    .take(1)
                                    .flatMap((watchNotification)=> _.get(watchNotification, 'object.status.succeeded') ?
                                        kefir.fromPromise(remote.getPods({ "job-name": jobName })).map(_.partial(_.get, _, 'items.0.metadata.name')) :
                                        kefir.constantError('Failed to complete task'))
                                    .flatMap((podName)=> kefir.fromPromise(remote.getPodLogs({ podName })))
                                    .map(_.flow(JSON.parse, (images)=> images.map((image)=> _.assign(image, { _source: nodeName }))));

                                stream.onEnd(stopWatch);
                                return stream;
                            }),
                            kefir.later().flatMap(()=> kefir.fromPromise(remote.deleteJob({ jobName }))).ignoreValues()
                        ])
                })
            )
        })
        .map(
            (images)=> _(images)
                .chain()
                .flatten()
                .groupBy('Id')
                .mapValues((images)=> _(images).chain().head().assign({ _source: _(images).groupBy('_source').keys().value() }).value()) //_(images).take(1).map((image)=> _.assign(image, { _source: _.map(image, '_source') })).first()
                .toArray()
                .value()
        );

probeStream.onValue((images)=> console.log(["The following images are available throughout Kubernetes:", ...images.map(({ Id })=> ` ${Id}`)].join('\n')));
probeStream.onError(console.warn);