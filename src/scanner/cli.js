const Scanner = require('./scanner');
const _ = require('lodash');

 Scanner.scanDeployment({wide:false}).then((v)=>{
  console.log(`the deployment is ${util.format(v)}`);
  const Table = require('cli-table');
  const headers = ["name", "desired", "current",
   "up-to-date", "available", "age" , "containers", "images(s)", "selector"];
    //NAME        DESIRED   CURRENT   UP-TO-DATE   AVAILABLE   AGE       CONTAINER(S)   IMAGE(S)           SELECTOR]
  // instantiate
  var table = new Table({
      head: headers
  //, colWidths: [100, 200]
});

// table is an Array, so you can `push`, `unshift`, `splice` and friends

  _.forEach(v, (d)=>{
     let spec = _.get(d, "deploy.metadata.spec")
    table.push(
        [d.name, d.status.]
      , ['First value', 'Second value']
    );
  })
})
