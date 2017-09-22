const Kube = require('../kubemote');
const kefir = require('kefir');
const util  = require('util');
const _     = require('lodash');

const podStatuses = ["Running", "Completed"]

class Scanner
{
  static scanReplicaSet({replicaSetName}={}){
      const kube = new Kube();
       console.log('...scan repicatsets');
      return kefir
      .fromPromise(kube.getReplicaSets())
       .map(v=>_.get(v, "items")).flatten()
       .filter((v)=>{
           return !(replicaSetName) ?true : _.get(v, "metadata.name") === replicaSetName;
       })
       .flatMap((v)=>{
        console.log(`meta : ${util.inspect(_.get(v, "metadata"))}`);
        console.log(`owner: ${util.inspect(_.get(v, "metadata.ownerReferences"))}`);
        console.log(`spec : ${util.inspect(_.get(v, "spec"))}`);
        console.log(`status : ${util.inspect(_.get(v, "status"))}`);
        return kefir.constant(v);
      }).log('replicaSets->').toPromise();
  }
  //deployment
  //pods
  //containers
  //image


  static scanDeployment({deploymentName="", wide=false} = {}) {
    const kube = new Kube();
    let deployments = kefir
      .fromPromise(kube.getDeployments()).map((s)=>{return _.get(s, "items");})
      .flatten()
      .filter((s)=>{
        let annotation = _.get(s, "metadata.annotations");
        console.log(`revision:
           ${util.format(annotation['deployment.kubernetes.io/revision'])}`);
        console.log(`deploy ${_.get(s, "metadata.name")}`);
        return !(deploymentName) ?true : _.get(s, "metadata.name") === deploymentName;
      })/*.map((v)=>{
        let name = _.get(v, "metadata.name");
        let status = _.get(v, "status");
        console.log('metadata:' + util.inspect(_.get(v, "metadata")));
        console.log('spec:' + util.inspect(_.get(v, "spec.template.spec")));
        console.log(util.inspect(_.get(v, "status.conditions")));
        return {name, status}
      })*/

    if (!wide)
       return deployments.flatMap((v)=>{
         return kefir.constant({name : _.get(v, "metadata.name"),
          status:_.get(v, "status")});
       }).scan((all , current)=>{
          all.push(current);
          return all;
       }, []).toPromise()

    let deployStatuses = deployments.flatMap((d)=>{
        let name = _.get(d, "name");
        console.log('name!:' + name);
        let status = _.get(d, "status");
        return kefir
        .fromPromise(kube.getPods(_.get(d, "spec.selector.matchLabels")))
        .map(v=>_.get(v, "items")).flatten().take(1).flatMap((v)=>{
          return kefir.constant(
            {deploy: d, containers:_.get(v, "status.containerStatuses")});
        })
      }).scan((all , current)=>{
         all.push(current);
         return all;
      }, []).log('extended=>')

      return deployStatuses.toPromise();
 }
  static scanServices({serviceName, getRelatedEntities=false}={}){
    const kube = new Kube();
    let services = kefir
      .fromPromise(kube.getDeployments()).map((s)=>{return _.get(s, "items");})
      .flatten()
      .filter((s)=>{
        console.log(`deploy ${_.get(s, "metadata.name")}`);
        return !(serviceName) ?true : _.get(s, "metadata.name") === serviceName;
      }).scan((all , current)=>{
         all.push(current);
         return all;
      }, []).log('services=>')
  }
}
/*Scanner.scanDeployment({wide:true}).then((v)=>{
  console.log('v:' + v );
  kefir.sequentially(0, v).map((d)=>{
     console.log(`the spec is ${util.format(d.deploy.spec)}`);
     console.log(`the metadata is ${util.format(d.deploy.metadata)}`);
     console.log(`the status is ${util.format(d.deploy.status)}`);
     return d;
  }).log('->');

})*/

module.exports = Scanner;
/*
kefir.sequentially([
Scanner.scanServices(),
Scanner.scanReplicaSet({replicaSetName:"testpod1-939059938"}),
Scanner.scanDeployment({deploymentName:"testpod1"})]).log('--->');*/
