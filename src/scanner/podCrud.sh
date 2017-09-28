#!/bin/bash

#usage() { echo "Usage: $0 [-s <45|90>] [-p <string>]" 1>&2; exit 1; }

while getopts a:p: option
do
 case "${option}"
 in
 a) ACTION=${OPTARG};;
 p) PODS=${OPTARG};;

 esac
done
echo kubectl $ACTION at $PODS times
COUNTER=0
      while [  $COUNTER -lt $PODS ]; do
        let COUNTER=COUNTER+1
        echo creating a pod $COUNTER
        kubectl $ACTION "testpod"$COUNTER --image verchol/microjob
      done
