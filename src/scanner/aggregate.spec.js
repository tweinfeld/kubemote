const Kube = require('../kubemote');
const kefir = require('kefir');
const util  = require('util');
const _     = require('lodash');

const podStatuses = ["Running", "Completed"]
describe('statuses', ()=>{
  const kube = new Kube();

  it('perService', (done)=>{
    let serviceName = "kubernetes";
    let service = kefir
    .fromPromise(kube.getServices()).map((s)=>{return _.get(s, "items");})
    .flatten()
    .filter((s)=>{

      return _.get(s, "metadata.name") === serviceName;
    }).log('services=>')

    let deploymens = service.flatMap((s)=>{
      console.log(`labels = ${util.format(s.lables)}`);

      return kefir.fromPromise(kube.getDeployments(s.labels))
      .map((s)=>{return _.get(s, "items");})
      .flatten();
    }).log('deploy->');

    let deployStatuses  = []
    deployStatuses = deploymens.scan((deployments , d)=>{
      let name = _.get(d, "metadata.name");
      let p =  ()=>{
        return kefir
      .fromPromise(kube.getPods(_.get(d, "spec.selector.matchLabels")))
      .map(v=>_.get(v, "items")).flatten();
      }
      deployments.push({name : name, pods : p});
      return deployments;
    }, deployStatuses).last().log('->');

    let podStatuses = deployStatuses.flatten().flatMap((d)=>{

       let p = d.pods().scan((status, pod)=>{
         status.push({
           deploy : _.get(d, "name"),
           name: _.get(pod , "metadata.name"),
           status: _.get(pod , "status") })
         return status;
       }, []);

       return p;

    }).log('deploy->');//.onValue(v=>console.log(util.inspect(v)))

    podStatuses.log('status->');
    podStatuses.onError(done);
    let aggregate = podStatuses.flatten().scan((statuses, v)=>{
      console.log('containerStatuses: '
        + util.format(_.get(v, "status.containerStatuses")));

      let deploy = _.get(v, "deploy");
      let name = _.get(v, "name");
      let status = _.get(v, "status.phase");
      statuses.push({deploy, name, status});
      return statuses;
    }, []).log('aggregate->');

    aggregate.toPromise().then((status)=>{
      console.log(util.inspect(status));
      done();
    }, done);

  })
})
