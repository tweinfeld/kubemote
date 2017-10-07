const
    _ = require('lodash'),
    kefir = require('kefir'),
    Table = require('cli-table'),
    Kubemote = require('../src/kubemote'),
    util  = require('util'),
    minimist = require('minimist');



let  columns ={
      name: "Name",
      desired: "Desired",
      current : "Current",
      available : "Available",
      age : "Age",
      images : "Images(s)",
      pods : "Pod(s)",
      selectors : "Selectors"
}
let usage = ()=>{
  console.log(`use flag --col=`);
  console.log(`available colums are ${_(columns).keys().join(' ,')}`);
}
let timeConverter = (date)=> {

    const MIL_IN_SEC = 1000;
    const MIL_IN_MIN = 60 * MIL_IN_SEC;
    const MIL_IN_HOUR = 60 * MIL_IN_MIN;
    const MIL_IN_DAY = 24 * MIL_IN_HOUR;

    let time = {};
    let factors = [MIL_IN_DAY, MIL_IN_HOUR, MIL_IN_MIN, MIL_IN_SEC];
    let letter = ["d", "h", "m", "s"];

    factors.reduce((agg, factor) => {
        _.set(agg.time, letter[agg.index], ~~(agg.rest / factor));
        agg.rest = agg.rest % factor;
        agg.index++;
        return agg;
    }, {time, index: 0, rest: date});


    time = _.pickBy(time, _.identity);
    let ret = _.map(time, (v, k) => v + `${k}:`)
        .slice(0, _.values(time).length).join('');

    return _.trimEnd(ret, ":");
};

const generateDeploymentsConsoleReport = function({
    namespace = "default",
    deploymentName = "",
    showImages = false,
    showPods = false,
    host, port, protocol,
    auth={host, port, protocol}
}) {
    let useCurrentContext = _(auth).omitBy(_.isUndefined).isEmpty();
    let client = new Kubemote(useCurrentContext?
       Kubemote.CONFIGURATION_FILE({ namespace }) : auth);

    return kefir
        .fromPromise(client.getDeployments())
        .flatMap((res)=> {
            return kefir.combine(
                (res["kind"] === "Deployment" ? [res] : res["items"])
                    .filter((deploymentName && _.matchesProperty('metadata.name', deploymentName)) || _.constant(true))
                    .map((deploymentDoc)=> {
                        return kefir.combine([
                            kefir.constant({deploy: deploymentDoc}),
                            (showImages || showPods) ?
                                kefir
                                    .fromPromise(client.getPods(_.get(deploymentDoc, 'spec.selector.matchLabels')))
                                    .map(({items: podDocs}) => (
                                        {
                                            podNames: _(podDocs).map('metadata.name').value(),
                                            containers: _(podDocs).map('status.containerStatuses').flatten().value()
                                        })) :
                                kefir.constant({})
                        ], _.merge);
                    })
            );
        })
        .map((report)=> {
            let table = new Table({
                head: _.compact(columns)
            });

            report.forEach((item) => {
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
                ], (v, f) => f(v));


               let model = [
                    name,
                    replicas,
                    updatedReplicas,
                    replicas - unavailableReplicas,
                    timeConverter(Date.now() - creationTimestamp),
                    ...(showImages ? [containers.map(({image}) => _.truncate(image, {length: 80})).join('\n')] : []),
                    ...(showPods ? [podNames.map((pod) => _.truncate(pod, {length: 50})).join('\n')] : []),
                    _.truncate(_.map(labels, (v, k) => `${k}=${v}`).join('\n'), {length: 100})
                ]

                let row = model.filter((v , index)=>columns[index]);
                table.push(row);

            });
            return table.toString();
        })
        .mapErrors(({message = "Unspecified"}) => message)
        .toPromise();
};

let argv = minimist(
    process.argv.slice(2),
    {
        alias: {
            "i": "showImages",
            "deploy": "deploymentName",
            "ns" : "namespace",
            "p"  : "showPods",
            "col": "columns",
            "h"  : "help"

        },
        boolean: ["showImages", "showPods", "help"],
        default: { deploymentName: "", namespace: "default" ,cols : "name,age,desired,current"/*,showPods : true,includeContainers: true*/ }
    }
);

if (argv.help)
 {
   usage();
   return process.exit(1);
 }
let selected = ((cols)=>{
  return  _(cols).trim().split(',').map(_.trim);
})(argv.cols)

columns = _(columns).map((v, k)=>{
    return (selected.indexOf(k) !==-1) ?v : false;
}).value();


generateDeploymentsConsoleReport(argv)
    .then(console.info)
    .catch(console.error);
