describe('progress tests', ()=>{
  it('test', (done)=>{
    const  Progress = require('cli-progress');

// create a new progress bar instance an

var bar1 = new Progress.Bar({}, Progress.Presets.shades_classic);

// start the progress bar with a total value of 200 and start value of 0
bar1.start(200, 0);

// update the current value in your application..
let i = 0;
let id= setInterval(()=>{
  bar1.update(i);
  i++;
  if (i>10){
    bar1.stop();
    clearInterval(id);
    done();
  }
}, 1000);

// stop the progress bar

  })
})
