#!/usr/bin/env node
const
    _ = require('lodash'),
    yargs = require('yargs'),
    kefir = require('kefir'),
    Table = require('cli-table'),
    util  = require('util'),
    Kubemote = require('../src/kubemote');

let client,cmdLineArgs;
cmdLineArgs = yargs
    .version(false)
    .usage("$0 --columns [[column identifiers]] --context [context] --deploy [deployment] --namespace [namespace] --format [json|table] --host [host] --port [port] --protocol [http|https]")
    .group(["deployment", "namespace"], 'Query Options:')
    .option('deployment', {
        type: "string",
        description: "Show one specific deployment name",
        alias: "deploy"
    })
    .option('namespace', {
        type: "string",
        description: "Query within a namespace",
        default:  "default",
        alias: "ns"
    })
    .group(["columns", "format"], 'Report Composition:')
    .option('colSize',
    //  alias: "col",
    { type: "array",
      description: "define columns size",
      coerce: (args)=>{
        let options = _(args).map((arg)=>{
          let opts = arg.split(/[,=]/)
          return [opts[0], ~~opts[1]];
        }).value();
        return options;
      }
    })
    .option('col', {

        type: "array",
        default:  {default:  {"name": 10,
          "desired" : 5,
          "current" : 5,
          "images" : 40,
          "pods" : 10,
          "selectors":10}
        },
        description: "Columns to include in the report",
        demandOption: "Please provide a list of required columns",
        coerce: (args)=>{

          const choices =
          {"name": 10,
          "desired" : 5,
          "current" : 5,
          "available" : 5,
          "age" : 10,
          "images" : 40,
          "pods" : 10,
          "selectors":10};

           if (_.get(args[0], "default"))
              return    args[0].default;


          if (!args)
          return choices;
          const colWidth  = [];
          _.fill(colWidth, choices.length, 10 )
;
          let shownCols = {};
          _.remove(args, (m)=>{
                return m.match(/^[,=?]$/g);
          });
          let options = _(args).map((arg)=>{
            let opts = arg.split(/[,=]/)
            _.set(shownCols, opts[0], ~~opts[1], 10);
            return arg;
          }).value();

          return shownCols;
        }
    })
    .option('format', {
        description: "Report type",
        choices: ["table", "json"],
        default: "table",
        type: "array",
        coerce: _.last
    })
    .group(["port", "host", "protocol", "context"], 'Connection:')
    .option('port', {
        type: "number",
        desc: "The port number to use when connecting",
      //  default: 8001,
        implies: ["host", "protocol"]
    })
    .option('proxy', {
      description : "use kubectl proxy to connect",
      //implies: ["host", "port", "protocol"],
    }).coerce('proxy', (argv)=>{

      opts = _.split(argv ,/[:,/]/g);
      let proxyOpts = {}
      _.set(proxyOpts , "protocol", "http")
      _.set(proxyOpts , "host", opts[0])
      _.set(proxyOpts , "port", opts[1])

      return proxyOpts;
    })
    .option('host', {
        type: "string",
        desc: "The host name to use when connecting",
        //default : "127.0.0.1",
        implies: ["port", "protocol"]
    })
    .option('protocol', {
        type: "string",
        desc: "The protocol to use for connection",
        choices: ["http", "https"],
        //default : "http",
        implies: ["host", "port"]
    })
    .option('context', {
        type: "string",
        description: "Use a specific configuration context",
        alias: "ctx"
    })
    .argv;

if (cmdLineArgs.proxy){
  cmdLineArgs.host = cmdLineArgs.proxy.host;
  cmdLineArgs.port = ~~(cmdLineArgs.proxy.port);
  cmdLineArgs.protocol = cmdLineArgs.proxy.protocol;
}

cmdLineArgs.colSize.forEach((o)=>{
  _.set(cmdLineArgs.col, o[0], o[1]);
})
const generateDeploymentsReport = function({
    context,
    namespace = "default",
    deployment = "",
    extended = false,
    host,
    port,
    protocol
}){


    try {
        client = new Kubemote(_.defaults({ host, port, protocol }, Kubemote.CONFIGURATION_FILE({ namespace, context })));
        client.setMaxListeners(1000);
    } catch(error){
        return Promise.reject(error);
    }

    return kefir
        .fromPromise(client.getDeployments())
        .flatMap((res)=> {
            return kefir.combine(
                (res["kind"] === "Deployment" ? [res] : res["items"])
                    .filter((deployment && _.matchesProperty('metadata.name', deployment)) || _.constant(true))
                    .map((deploymentDoc)=> {
                        return kefir.combine([
                            kefir.constant({deploy: deploymentDoc}),
                            extended ?
                                kefir
                                    .fromPromise(client.getPods(_.get(deploymentDoc, 'spec.selector.matchLabels')))
                                    .map(({ items: podDocs }) => (
                                        {
                                            podNames: _(podDocs).map('metadata.name').value(),
                                            containers: _(podDocs).map('status.containerStatuses').flatten().value()
                                        }
                                    )) :
                                kefir.constant({})
                        ], _.merge);
                    })
            );
        })
        .map((report)=>
            report.map((item)=> {
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

                return Object.assign({
                    name,
                    desired: replicas,
                    current: updatedReplicas,
                    available: replicas - unavailableReplicas,
                    age: Date.now() - creationTimestamp,
                    selectors: labels
                }, extended && {
                    images: containers,
                    pods: podNames
                });
            })
        )
        .mapErrors(({ message = "Unspecified" } = {}) => message)
        .takeErrors(1)
        .toPromise();
};
const listImages = require('./probe_images').listImages;
const reportFormatters = {
    "json": (columns, rawReport)=> rawReport.map((row)=> _.pick(row, columns)),
    "table": (function(){
        const timeSpanFormatter = (function(){
                const
                    MIL_IN_SEC = 1000,
                    MIL_IN_MIN = 60 * MIL_IN_SEC,
                    MIL_IN_HOUR = 60 * MIL_IN_MIN,
                    MIL_IN_DAY = 24 * MIL_IN_HOUR,
                    factors = [MIL_IN_DAY, MIL_IN_HOUR, MIL_IN_MIN, MIL_IN_SEC],
                    captions = ["s", "m", "h", "d"];

                return (span)=>
                    _(factors)
                        .map((function(ac){
                            return (factor)=> {
                                let sectionValue = ~~(ac / factor);
                                ac = ac % factor;
                                return sectionValue;
                            }
                        })(span))
                        .dropWhile(_.negate(Boolean))
                        .reverse()
                        .map((v, index)=> [_.padStart(v, 2, '0'), captions[index]].join(''))
                        .reverse()
                        .join(':');
            })();

        const columnsFormats = {
            "name": { caption: "Name" },
            "desired": { caption: "Desired" },
            "current": { caption: "Current" },
            "available":  { caption: "Available" },
            "age": { caption: "Age", formatter: timeSpanFormatter },
            "images": { caption: "Images(s)", formatter: (containers, imagesList)=>{

               let all = containers.map(({image})=>{
               //let truncatedImage = _.truncate(image, { length: 80 });
               let tags =  _.filter(imagesList, (i)=>{
                   //console.log(`${image}-${util.format(i)} , ${i.RepoTags}`);
                  return _(i.RepoTags).some((tag)=> tag === image)
            }).map((i)=>i.Labels);
               return image + "\nlabels : \n======\n" + _.chain(tags).head().toPairs('=').value().join('\n');
          })
             return all.join('\n');
        }
      },
            "pods": { caption: "Pod(s)", formatter: (podNames)=> podNames.map((pod)=> _.truncate(pod, { length: 50 })).join('\n') },
            "selectors": { caption: "Selectors", formatter: (labels)=> _.truncate(_.map(labels, (v, k) => `${k}=${v}`).join('\n'), { length: 100 }) }
        };

        return function(columns, rawReport){

            let table = new Table(
              { head: _.map(columns , (width , col)=> {
                  return columnsFormats[col]["caption"]
                })

              , colWidths: _.values(columns)

          });
            rawReport.forEach((row)=> table.push(_.map(columns,
              (width, columnName)=>
              (columnsFormats[columnName].formatter || _.identity)(row[columnName],
                 rawReport.imagesList)))) ;
            return table.toString();
        };
    })()
};


generateDeploymentsReport(
    Object.assign(
        _.pick(cmdLineArgs, ["namespace", "deployment", "context"]),
        { extended: _(cmdLineArgs["col"]).keys().some((selectedColumn)=> ["pods", "images"].includes(selectedColumn))},
        _.at(cmdLineArgs, ["port", "host", "protocol"]).some(Boolean) && _.pick(cmdLineArgs, ["port", "host", "protocol"])
    ))

    .then((report)=>{

      return listImages({waitPeriod:200000}).scan((prev , next)=>{
        prev.push(next);
        return prev;
      }, []).toPromise().then((images)=>{
          report.imagesList = images;
          return report;
      })

    })
    .then(_.partial(reportFormatters[cmdLineArgs["format"]], cmdLineArgs["col"] || {name:10}))
    .then(console.log)
    .catch(console.warn);
