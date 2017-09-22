const Scanner = require('./scanner');
const _ = require('lodash')
const Table = require('cli-table');
const util  = require('util');
const assert = require('assert');

 Scanner.scanDeployment({wide:true}).then((v)=>{
  console.log(`the deployment is ${util.format(v)}`);

  const headers = ["name", "desired", "current",
   "up-to-date", "available", "age" , "containers", "images(s)", "selector"];
  let table = new Table({
      head: headers
  //, colWidths: [100, 200]
});

assert(table);
 
  _.forEach(v, (d)=>{
     let status = _.get(d, "deploy.status")
     console.log(`status  = ${util.format(status)}`);
     let meta = _.get(d, "deploy.metadata");
     let spec = _.get(d, "deploy.spec");
     let name = _.get(meta, "name");
     console.log(`meta  = ${util.format(meta)}`);
     console.log(`spec  = ${util.format(spec)}`);
     let desired = _.get(status, "replicas");
     let current = _.get(status , "updatedReplicas");
     let available = parseInt(desired)- parseInt(_.get(status , "unavailableReplicas"))
     let containers = util.format(_.get(d, "containers[0].image"));
     let selector  =  util.format(_.get(meta, "labels"));

    table.push(
        [name , desired, current, available, containers, selector]);
  })
  console.log(table.toString());
})
/*
status:
    { observedGeneration: 1,
      replicas: 1,
      updatedReplicas: 1,
      readyReplicas: 1,
      availableReplicas: 1,
      conditions: [Object] } },
      */
