const _ = require('lodash');
const util  = require('util');
const fs  = require('fs');
const Kube = require('../kubemote');
class K8Auth{

     login(options){

         this.kube = new Kube(options);//options ? "" : options);

         return this;
     }
     getPods(){
       return this.kube.getPods();     }
}

/*new K8Auth().login().getPods().then((pods)=>{
  console.log(`pods ${util.format(pods)}`);

}, console.log);
*/

let options = {
 host: "127.0.0.1" || "35.202.177.20"
,port: "8001"
,protocol: "http"
//,username : "admin"/
//,password : "6mlzvTuLNsJd8Sel",
//certificate_authority :  fs.readFileSync('./test.crt', "utf-8")
}

//,"client_certificate":  fs.readFileSync('./test.crt', "utf-8")}
new K8Auth().login(options).getPods().then((pods)=>{
  console.log(`pods ${util.format(pods)}`);

}, console.log);
