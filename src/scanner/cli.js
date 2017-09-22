const Scanner = require('./scanner');
const _ = require('lodash')
const Table = require('cli-table');
const util  = require('util');
const assert = require('assert');
const moment = require('moment');
const milisecInHour = 1000*60*60;



 Scanner.scanDeployment({/*deploymentName : "test",*/  wide:true}).then((v)=>{
  console.log(`the deployment is ${util.format(v)}`);

  const headers = ["name", "desired", "current",
   "up-to-date", "available", "age" , "containers", "images(s)", "selector"];
  let table = new Table({
      head: headers
  //, colWidths: [100, 200]
});

//lastUpdateTime: '2017-09-17T05:09:28Z',
       //lastTransitionTime: '2017-09-17T05:09:28Z',


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
     let upToDate = "----";
     let containers = util.format(_.get(d, "containers[0].image"));
     let selector  =  util.format(_.get(meta, "labels"));
     let creationTime = _.get(meta, "creationTimestamp");
     let diff =  moment.utc().diff(moment.utc(creationTime));

     let age = `${Math.floor(diff/milisecInHour)}h`;

    table.push(
        [name , desired, current,upToDate, available, age ,containers, selector]);
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
