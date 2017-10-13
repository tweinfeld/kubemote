const
    _ = require('lodash'),
    fs = require('fs'),
    Kubemote = require('../src/kubemote'),
    kefir = require('kefir'),
    uuid = require('uuid');

let
    remote = new Kubemote(),
    nodeName = "minikube",
    jobName = _(uuid.v4()).split('-').first();
    probeStream = kefir.fromPromise(remote.createJob({
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
                                                        "args": ["-c", "docker inspect $(docker images --no-trunc -aq) && sleep 50"],
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
                                                "nodeName":"minikube",
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
                            )).flatMap(a=>
                            kefir.sequentially(5000, [1,2,3,4,5]).flatMap(
                              a=>kefir.fromPromise(remote.getPods({ "job-name": jobName })).map(_.partial(_.get, _, 'items.0.metadata.name')).log()
                            .flatMap((podName)=> kefir.fromPromise(remote.getPodLogs({ podName }))).log()
                            .map(_.flow(JSON.parse, (images)=> images.map((image)=> _.assign(image, { _source: nodeName })))).log()
                          ));

        /*.map(
            (images)=> _(images)
                .chain()
                .flatten()
                .groupBy('Id')
                .mapValues((images)=> _(images).chain().head().assign({ _source: _(images).groupBy('_source').keys().value() }).value()) //_(images).take(1).map((image)=> _.assign(image, { _source: _.map(image, '_source') })).first()
                .toArray()
                .value()
        );*/
probeStream.spy('prob');

probeStream.onValue((images)=> console.log(["The following images are available throughout Kubernetes:", ...images.map(({ Id })=> ` ${Id}`)].join('\n')));
probeStream.onError(console.warn);
