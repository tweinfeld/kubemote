   const Api = require('kubernetes-client');
   const _  = require('lodash');

  module.exports =  class KubeClient
   {
     constructor({url='http://127.0.0.1:8001', auth}){
     //=Api.config.fromKubeconfig()){

       //const core = new Api.Core(Api.config.fromKubeconfig());
       let options = _.pickBy({url, auth});
       const core = new Api.Core(options);
       const api = new Api.Api(options);
       const batch = new Api.Batch(options);
       this.client = {
           api, core, batch
         }
     }
    getServices(selector){

    }

    getPods({name, labelSelector=""}){
      return new Promise((resolve, reject)=>{
        const manifest = {
          kind: 'pods',
          apiVersion: 'v1'
        //  apiVersion: 'extensions/v1beta1'
        }
        //const stream = this.client.api.group(manifest).ns.kind(manifest).getStream({ qs: { follow: true } });
        const stream = this.client.core.ns.pods(name,labelSelector).getStream({ qs: { follow: true } });

        const JSONStream = require('json-stream');
        const jsonStream = new JSONStream();
        let pods = [];
        stream.pipe(jsonStream);
        jsonStream.on('data', chunk => {
          pods.push(chunk);
         });
         jsonStream.on('end', ()=>{
           resolve(pods[0]);
         });
      })
    }

    getDeployments({name , selector=""}={}){

      return new Promise((resolve, reject)=>{
        const manifest = {
          kind: 'Deployment',
          apiVersion: 'extensions/v1beta1'
        }
        const stream = this.client.api.group(manifest).ns.kind(manifest).getStream({ qs: { follow: true } });
        const JSONStream = require('json-stream');
        const deployments = new JSONStream();
        let deploy = [];
        stream.pipe(deployments);
        deployments.on('data', chunk => {
           deploy.push(chunk);
         });
         deployments.on('end', ()=>{
           resolve(deploy[0].items);
         });
      })
    }

    patchDeployment({ name, spec }){

    }

    deleteDeployment({ name }){

    }

    getPodLogs({ podName }){
      let logs = [];
      const JSONStream = require('json-stream');
      const jsonStream = new JSONStream();
      const stream = this.client.core.ns.po(podName).log.getStream({ qs: { follow: true } });
      return new Promise((resolve, reject)=>{
      stream.pipe(jsonStream);

      jsonStream.on('data', chunk => logs.push(chunk));
      jsonStream.on('error', chunk => reject(logs));
      jsonStream.on('end', chunk => resolve(logs));

     });

    }

    createDeployment(deploymentSpecJson){

    }

    createJob(jobSpecJson){
      return new Promise((resolve, reject)=>{
          this.client.batch.jobs.post({"body": jobSpecJson}, (err, data)=>{
            return (err) ? reject(err) : resolve(data);
          });
      })

    }

    watchDeploymentList(selector){

    }

    watchPodList(selector){

    }

    watchServiceList(selector){

    }

    watchJobList(selector){

    }

    watchJob({ jobName, selector }){

    }

    deleteJob({ jobName }){

    }

    getNodes(){
      return new Promise((resolve, reject)=>{
        const manifest = {
          kind: 'nodes',
          apiVersion: 'v1'
        }
        const stream = this.client.core.nodes.getStream({ qs: { follow: true } });
        const JSONStream = require('json-stream');
        const jsonStream = new JSONStream();
        let nodes = [];
        stream.pipe(jsonStream);
        jsonStream.on('data', chunk => {
           nodes.push(chunk);
         });
         jsonStream.on('error', err => {
            reject(err);
          });
         jsonStream.on('end', ()=>{
           resolve(nodes[0].items);
         });
      })
    }

  }



//new KubeClient().getPods({name:"microjob-1627975937-17zl6"}).then(console.log);
