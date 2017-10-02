const
    _ = require('lodash'),
    kefir = require('kefir'),
    Table = require('cli-table'),
    Kubemote = require('../kubemote');
    const util  = require('util');
    const minimist = require('minimist');


let timeConverter = (date)=>{

  const MIL_IN_SEC = 1000;
  const MIL_IN_MIN = 60*MIL_IN_SEC;
  const MIL_IN_HOUR = 60*MIL_IN_MIN;
  const MIL_IN_DAY =  24 * MIL_IN_HOUR;

   let time = {};
     let factors = [MIL_IN_DAY, MIL_IN_HOUR, MIL_IN_MIN, MIL_IN_SEC];
     let letter = ["d", "h", "m", "s"]

     factors.reduce((agg, factor)=>{

        _.set(agg.time, letter[agg.index],~~(agg.rest/factor));
        agg.rest = agg.rest%factor;
        agg.index++;
        return agg;
      }, {time, index:0, rest:date})


     time = _.pickBy(time, _.identity);
     let ret =  _.map(time, (v, k)=>v + `${k}:`)
     .slice(0, _.values(time).length).join('');

     return _.trimEnd(ret, ":");
}
const generateDeploymentsConsoleReport = function({ namespace="default", deploymentName = "", includeContainers = false, showPods=false }){
    console.log(`namespace ${namespace}`);
    let client = new Kubemote(Kubemote.CONFIGURATION_FILE({namespace}));
    return kefir
        .fromPromise(client.getDeployments())
         .flatMap((res)=> {
            //console.log(`name ${_.get(res, 'metadata.name')}`);

            return kefir.combine(
                (res["kind"] === "Deployment" ? [res] : res["items"])
                    .filter((deploymentName &&_.matchesProperty('metadata.name', deploymentName)) || _.constant(true))
                    .map((deploymentDoc)=>{
                        return kefir.combine([
                            kefir.constant({ deploy: deploymentDoc }),
                            (includeContainers || showPods) ?
                                kefir
                                    .fromPromise(client.getPods(_.get(deploymentDoc, 'spec.selector.matchLabels')))
                                    .map(({ items: podDocs })=>(
                                      {  podNames : _(podDocs).map('metadata.name').value(),
                                         containers: _(podDocs).map('status.containerStatuses').flatten().value() })) :
                                kefir.constant({})
                        ], _.merge)
                    })
            );
        }).log('->')
        .map((report)=>{

            //console.log(`adding report ${util.format(report)}`);
            let table = new Table({ head: _.compact(
              [ "Name", "Desired", "Current", "Available",
               "Age",
                includeContainers && "Images(s)",
                showPods && "Pod(s)",
                "Selectors" ]) });

            report.forEach((item)=>{
                let [name, replicas, updatedReplicas, unavailableReplicas, creationTimestamp, containers, podNames, labels] = _.zipWith(_.at(item, [
                    "deploy.metadata.name",
                    "deploy.status.replicas",
                    "deploy.status.updatedReplicas",
                    "deploy.status.unavailableReplicas",
                    "deploy.metadata.creationTimestamp",
                    "containers",
                    "podNames",
                    "deploy.metadata.labels"
                ]), [
                    _.identity,
                    _.toInteger,
                    _.toInteger,
                    _.toInteger,
                    Date.parse,
                    _.identity,
                    _.identity,
                    _.identity,
                ], (v, f)=> f(v));



                table.push([
                    name,
                    replicas,
                    updatedReplicas,
                    replicas - unavailableReplicas,
                    timeConverter(Date.now() - creationTimestamp),
                    ...(includeContainers ? [containers.map(({ image })=> _.truncate(image, { length: 50 })).join('\n')] : []),
                    ...(showPods ? [podNames.map((pod)=> _.truncate(pod, { length: 50 })).join('\n')] : []),
                    _.truncate(_.map(labels, (v,k)=> `${k}=${v}`).join(' '), { length: 50 })
                ]);
            });
            console.log(`-c ${includeContainers}`);
            return table.toString();
        })
        .mapErrors(({ message = "Unspecified" })=> message)
        .toPromise();
};

let argv = minimist(process.argv.slice(2),
{ alias:{
  c : "includeContainers",
  deploy : "deploymentName",
  ns : "namespace",
  p : "showPods",
  w : "wide"
},
  boolean: ["includeContainers", "showPods"],
  default: {deploymentName: "", namespace : "default"/*,showPods : true,includeContainers: true*/}

});

generateDeploymentsConsoleReport(
      argv
    )
    .then(console.info)
    .catch(console.error);
