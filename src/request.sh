#!/bin/bash
echo on
PIPELINE=599d7dd04828a900010a009c
TOKEN=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJfaWQiOiI1NTJlOTQyMjM4MjQ4MzFkMDBiMWNhM2UiLCJhY2NvdW50SWQiOiI1NjgwZjEzMDM0Y2RiMzE3N2M4MmFjYjIiLCJpYXQiOjE1MDU4ODg0OTUsImV4cCI6MTUwODQ4MDQ5NX0.LfbPT33py0sahYOsL9VdSS-4GSIB5rE9G22hbQWyDgs
PAYLOAD={"repoOwner":"containers101","repoName":"demochat","serviceId":"599d7dd04828a900010a009c","branch":"master","type":"build","variables":{},"options":{},"isYamlService":false}
#@echo $PAYLOAD |
curl --verbose -d '{"repoOwner":"containers101","repoName":"demochat","serviceId":"599d7dd04828a900010a009c","branch":"master","type":"build","variables":{},"options":{},"isYamlService":false}' -H "Content-Type: application/json"  -H "x-access-token:"$TOKEN -X POST  https://g.codefresh.io/api/builds/$PIPELINE
