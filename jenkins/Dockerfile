#FROM openshift/jenkins:latest
#FROM jds-sandbox/jenkins-2-rhel7:latest 
#FROM registry.access.redhat.com/openshift3/jenkins-2-rhel7
#FROM docker-registry.default.svc:5000/jds-sandbox/jenkins-2-rhel7
FROM registry.access.redhat.com/openshift3/jenkins-2-rhel7@sha256:6a9cfb9574da47a92f6b241b9b7ea66132e6d4fbfb2bd386697781aac9ceda2f
USER 0
COPY plugins.txt /plugins.txt
RUN /usr/local/bin/install-plugins.sh /plugins.txt
USER root
RUN wget https://repos.fedorapeople.org/repos/dchen/apache-maven/epel-apache-maven.repo -O /etc/yum.repos.d/epel-apache-maven.repo 
RUN yum --disablerepo=rhel-7-server-rpms install -y apache-maven
# drop back to the regular jenkins user - good practice
USER 1001