const
    _ = require('lodash'),
    fs = require('fs'),
    Kubemote = require('../src/kubemote'),
    kefir = require('kefir'),
    uuid = require('uuid');

let
    remote = new Kubemote(),
    jobName = _(uuid.v4()).split('-').first();

kefir
    .fromPromise(remote.getNodes())
    .map((podList)=> _(podList["items"]).map('metadata.name').uniq().value())
    .flatMap((nodeNameList)=> {
        return kefir.combine(
            nodeNameList.map((nodeName)=> {
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
                                            "nodeName": "minikube",
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
                        kefir.fromPromise(remote.watchJob({ jobName })).ignoreValues(),
                        kefir
                            .fromEvents(remote, 'watch')
                            .filter(_.matches({ object: { kind: "Job", metadata: { name: jobName }} }))
                            .filter((watchNotification)=> _.get(watchNotification, 'object.status.completionTime'))
                            .take(1)
                            .flatMap((watchNotification)=> _.get(watchNotification, 'object.status.succeeded') ?
                                kefir.fromPromise(remote.getPods({ "job-name": jobName })).map(_.partial(_.get, _, 'items.0.metadata.name')) :
                                kefir.constantError('Failed to complete task'))
                            .flatMap((podName)=> kefir.fromPromise(remote.getPodLogs({ podName })))
                            .map(JSON.parse),
                        kefir.later().flatMap(()=> kefir.fromPromise(remote.deleteJob({ jobName }))).ignoreValues()
                    ])
            })
        )
    })
    .map(_.flatten)
    .map(_.partial(_.groupBy, _, 'Id'))
    .map(_.partial(_.mapValues, _, _.first)) // Peek here to see all images info
    .map(Object.keys)
    .onValue((images)=> console.log(["The following images are available throughout Kubernetes:", ...images.map((image)=> ` ${image}`)].join('\n')));