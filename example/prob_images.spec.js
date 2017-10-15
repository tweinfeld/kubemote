const listImages = require('./probe_images').listImages;
describe('prob imagtes test', ()=>{
  it('test single image by name', (done)=>{
    listImages({byName:true, imageName:"verchol/microjob:latest"})
    .takeError(1).onEnd(done);
  })
})
