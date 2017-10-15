const _ = require('lodash');
module.exports.Config= (images)=>{
  return _(images).map(({ Id, Config})=>{
    return {Id, Config}
  }).value();
}
module.exports.Labels = ({Id, RepoTags, Config}, filter)=>{
  return {Id,
      RepoTags,
      Labels: Config.Labels}
}
