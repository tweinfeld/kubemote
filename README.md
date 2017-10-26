# Extended K8s deployments info CLI

Nodejs CLI that shows Kuberentes deployment extended info like pod selectors , images names and labels.
you can control shown columns and size 
# Installation

```npm install -g kubemote```

# Usage

 cli is using current context but recomended way is to run proxy 
 ```kubectl proxy```
 Then run the cli :
 
 kubenode --proxy=127.0.0.1:8001
 
 by default it will show all deployments , desired and current replicas ,image info , pods name and selectors
 
 

