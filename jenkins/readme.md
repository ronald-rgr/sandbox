# Jenkins Setup and Installation 

## Build Custom Jenkins Image
Run the following command to build custom Jenkins image.  Namespace and base image can be changed using parameters specified in bc.yaml.  Additional plugins can be added to plugins.txt
```
oc -n jds-filing-tools process -f "https://raw.githubusercontent.com/ronald-rgr/sandbox/master/jenkins/openshift/bc.yaml" -p NAMESPACE=jds-filing-tools -o yaml | oc -n jds-filing-tools create -f -
```

## Start Jenkins Build
This step can take a minute or two.  Make sure it has completed successfully in OpenShift before starting the next step.
```
oc -n jds-filing-tools start-build bc/jenkins-custom-build
```

## Deploy Jenkins
This creates everything required for Jenkins instance.  It also creates a pvc for maven slaves. 
This deployment occasionally take a very long time. If it timesout, try redeploying it.
```
oc -n jds-filing-tools process -f "https://raw.githubusercontent.com/ronald-rgr/sandbox/master/jenkins/openshift/dc.json" -p NAMESPACE=jds-filing-tools -o yaml | oc -n jds-filing-tools create -f -
```

## Grant Jenkins Access to all Namespaces
```
oc -n c2mvws-dev policy add-role-to-user admin system:serviceaccount:c2mvws-tools:jenkins
oc -n c2mvws-test policy add-role-to-user admin system:serviceaccount:c2mvws-tools:jenkins
oc -n c2mvws-prod policy add-role-to-user admin system:serviceaccount:c2mvws-tools:jenkins
```

## Clean Up
To delete everything created for Jenkins instance run
```
oc delete all,configmap,pvc,serviceaccount,rolebinding,secret,build -l template=jenkins-persistent-template -o name
```
To delete custom Jenkins image and build run
```
oc -n jds-filing-tools delete all,template,secret,cm,pvc,sa,rolebinding --selector app=jenkins-custom
```
