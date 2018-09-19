const listImages = require('./probe_images').listImages;
describe('prob imagtes test', ()=>{
  it('test single image by name', (done)=>{
    listImages({byName:true, imageName:"verchol/microjob:latest"})
    .takeErrors(1).log().onEnd(done);
  })
  it('test', (done)=>{
    const kefir = require('kefir');
    const Kubemote =  require('../src/kubemote');
    const core = new Api.Core(Api.config.fromKubeconfig());
    let remote  = new Kubemote();
    kefir.fromPromise(remote.getPodLogs({ podName : "microjob-1627975937-5sdwl" })).map((logs)=>
    {
     console.log(`logs ${logs}`);
     return logs;
   }).takeErrors(1).log().  onEnd(done);

  })
  it('test get nodes', (done)=>{
    const Client = require('../src/kubemoteWrapper');
    (new Client()).getNodes().then(console.log).then(done);
  })
  it('jobs api call ', (done)=>{

  })
  it.only('test create jobs', (done)=>{
    const Client = require('../src/kubemoteWrapper');
    const fs =  require('fs');
    const yaml = require('js-yaml');
    const _ = require('lodash');

    let jobTemplate = yaml.safeLoad(fs.readFileSync('./templates/jobs.yaml', "utf-8"));
    let jobName = _(uuid.v4()).split('-').first();
    _.set(jobTemplate, "metadata.name", jobName);
    _.set(jobTemplate, "metadata.labels.job-name", jobName);
    _.set(jobTemplate, "spec.template.metadata.labels.job-name", jobName);
  //  _.set(jobTemplate, "spec.template.spec.nodeName", nodeName);
    _.set(jobTemplate, "spec.template.spec.containers[0].args[1]", "docker inspect $(docker images -aq --no-trunc)");

if (false){
 const request = require('superagent');
    request
    .post('127.0.0.1:8001/apis/batch/v1/namespaces/default/jobs')
    .send(jobTemplate) // sends a JSON post body
    .set('accept', 'application/json')
    .end((err, res) => {
      console.log(res);

    done(err);
  });
}

 let token = process.env.auth;
 let url =  "https://35.202.177.20";
  const Kubemote = require('../src/kubemote');
  let client = new Kubemote({host:"127.0.0.1", port:8001, protocol:"http"});
  client.createJob(jobTemplate).then(()=>{
    return done()

  }, (err)=>{
    console.log(err);
    done();
  });
  //  (new Client({})).client.batch.jobs.post({"body": jobTemplate}, console.log);

  })
  it('test kubeclient', (done)=>{
    const Api = require('kubernetes-client');
    //const core = new Api.Core(Api.config.fromKubeconfig());
    const core = new Api.Core({url: 'http://127.0.0.1:8001'});
    const api = new Api.Api({url: 'http://127.0.0.1:8001'});
    const JSONStream = require('json-stream');
    const jsonStream = new JSONStream();
    const manifest0 = {
      kind: 'Deployment',
      apiVersion: 'extensions/v1beta1'

    };
  //  const stream = core.ns.po.getStream({ qs: { watch: true } });
   const stream = core.ns.po('microjob-1627975937-17zl6').log.getStream({ qs: { follow: true } });
    stream.on('data', chunk => {
      process.stdout.write(chunk.toString());
    });
    //stream.on('end', done);

    const stream2 = api.group(manifest0).ns.kind(manifest0).getStream({ qs: { follow: true } });
     stream2.on('data', chunk => {
       process.stdout.write(chunk.toString());
     });
     stream2.on('end', done);


  })
})
