const
    _ = require('lodash'),
    kefir = require('kefir'),
    Table = require('cli-table'),
    Kubemote = require('../kubemote');
    const util  = require('util');

const argumentParsers = [
    (str)=> ((match)=> match && { includeContainers: _.get(match, '3') !== "0" })(str.match(/^(-c|--containers?)(=([01]))?$/)),
    (str)=> ((match)=> match && { deploymentName: _.get(match, '0', '') })(str.match(/^\w+$/))
];

const MILLISECONDS_IN_HOUR = 3600000;
const HOURS_IN_DAYS  = 24;
let timeConverter = (date)=>{
   let hours = ~~(date/MILLISECONDS_IN_HOUR);
   let days = ~~(hours/HOURS_IN_DAYS);

   return (days) ? [days, 'd'].join('') : [hours, 'h'];
}
const generateDeploymentsConsoleReport = function({ deploymentName = "", includeContainers = false }){

    let client = new Kubemote();
    return kefir
        .fromPromise(client.getDeployments()).map()
         .log('deploy->').flatMap((res)=> {
            //console.log(`name ${_.get(res, 'metadata.name')}`);
            return kefir.combine(
                (res["kind"] === "Deployment" ? [res] : res["items"])
                    .filter((deploymentName &&_.matchesProperty('metadata.name', deploymentName)) || _.constant(true))
                    .map((deploymentDoc)=>{
                        return kefir.combine([
                            kefir.constant({ deploy: deploymentDoc }),
                            includeContainers ?
                                kefir
                                    .fromPromise(client.getPods(_.get(deploymentDoc, 'spec.selector.matchLabels')))
                                    .map(({ items: podDocs })=>({ containers: _(podDocs).map('status.containerStatuses').flatten().value() })) :
                                kefir.constant({})
                        ], _.merge)
                    })
            );
        }).log('->')
        .map((report)=>{
            console.log('adding report');
            let table = new Table({ head: _.compact([ "Name", "Desired", "Current", "Available", "Age", includeContainers && "Images(s)", "Selectors" ]) });
            report.forEach((item)=>{
                let [name, replicas, updatedReplicas, unavailableReplicas, creationTimestamp, containers, labels] = _.zipWith(_.at(item, [
                    "deploy.metadata.name",
                    "deploy.status.replicas",
                    "deploy.status.updatedReplicas",
                    "deploy.status.unavailableReplicas",
                    "deploy.metadata.creationTimestamp",
                    "containers",
                    "deploy.metadata.labels"
                ]), [
                    _.identity,
                    _.toInteger,
                    _.toInteger,
                    _.toInteger,
                    Date.parse,
                    _.identity,
                    _.identity,
                ], (v, f)=> f(v));
                console.log(`container : ${util.format(containers)}`);
                table.push([
                    name,
                    replicas,
                    updatedReplicas,
                    replicas - unavailableReplicas,
                    timeConverter(Date.now() - creationTimestamp),
                    ...(includeContainers ? [containers.map(({ image })=> _.truncate(image, { length: 50 })).join('\n')] : []),
                    _.truncate(_.map(labels, (v,k)=> `${k}=${v}`).join(' '), { length: 50 })
                ]);
            });

            return table.toString();
        })
        .mapErrors(({ message = "Unspecified" })=> message).log()
        .toPromise();
};
console.log(process
    .argv);
generateDeploymentsConsoleReport(
    process
        .argv
        .slice(2)
        .reduce((ac, arg)=> _.assign(ac, argumentParsers.map((parser)=> parser(arg) || {}).reduce(_.merge)), {})
    )
    .then(console.info)
    .catch(console.error);
