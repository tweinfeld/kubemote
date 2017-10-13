const
    _ = require('lodash'),
    fs = require('fs'),
    Kubemote = require('../src/kubemote'),
    kefir = require('kefir'),
    uuid = require('uuid'),
    util = require('util'),
    yaml = require('js-yaml');

  let jobTemplate = yaml.safeLoad(fs.readFileSync('./templates/jobs.yaml', "utf-8"));
  jobTemplate.nodeName = "minikube";

let
    remote = new Kubemote(),
    probeStream = kefir
        .fromPromise(remote.getNodes())
        .map((podList)=> _(podList["items"]).map('metadata.name').uniq().value())
        .flatMap((nodeNameList)=> {
            return kefir.combine(
                nodeNameList.map((nodeName)=> {
                    let jobName = _(uuid.v4()).split('-').first();
                    _.set(jobTemplate, "metadata.name", jobName);
                    _.set(jobTemplate, "metadata.labels.job-name", jobName);
                    _.set(jobTemplate, "spec.template.metadata.labels.job-name", jobName);
                    console.log(jobTemplate);
                    return kefir
                        .concat([
                            kefir.fromPromise(remote.createJob(jobTemplate)).ignoreValues(),
                            kefir.fromPromise(remote.watchJob({ jobName })).flatMap((stopWatch)=>{
                                let stream = kefir
                                    .fromEvents(remote, 'watch').log()
                                    .filter(_.matches({ object: { kind: "Job", metadata: { name: jobName }} })).log('job-watch')
                                    .filter((watchNotification)=> _.get(watchNotification, 'object.status.completionTime'))
                                    //.take(1)
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
        }).log('images->')
        .map(
            (images)=> _(images)
                .chain()
                .flatten()
                .uniqBy('Id')
                //.groupBy('Id')
                //.mapValues((images)=> _(images).chain().head().assign({ _source: _(images).groupBy('_source').keys().value() }).value()) //_(images).take(1).map((image)=> _.assign(image, { _source: _.map(image, '_source') })).first()
                .toArray()
                .value()
        );

probeStream.onValue((images)=> console.log(["The following images are available throughout Kubernetes:", ...images.map(({ Id, Config})=> ` ${Id}- ${util.format(Config.Labels)}`)].join('\n')));
probeStream.onError(console.warn);
