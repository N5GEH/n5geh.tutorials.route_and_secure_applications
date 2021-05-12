## Integrate Keycloak Gatekeeper with Traefik to secure your apps.

### Install

This tutorial uses [Docker Engine](https://docs.docker.com/engine/install/) version "19.03.8" containerization, [docker-compose](https://docs.docker.com/compose/) "3.7" and [traefik](https://docs.traefik.io/) "v2.2" as a reverse proxy on an Ubuntu 18.x machine.

### Step 1: Starting a web application via docker-compose.

In this section, we start a docker image to deploy a simple web application, which will become our protected resource. 

*Step 1.1:* The image is run via docker-compose using a compose file. The composition is shown below, the file can be found [here](tutorial/1.%20Setting%20up%20Testpage/docker-compose.yml).

```yaml
version: '3.7'
services:
  testpage:
    image: crccheck/hello-world
    container_name: testpage
    hostname: testpage
    ports:
       - 8080:8000
```
The compose file shows that a service called "testpage” will be created. The ports are configured in the *host:container* format. Our application and the container respectively are configured to listen on port 8000. We map this port to the host port 8080.

*Step 1.2:* The web application can be started using the command *docker-compose up -d*. You can check whether everything is configured correctly and lookup *http://localhost:8080* in your browser. You should see the screen below.

![Localhost Web App](tutorial/1.%20Setting%20up%20Testpage/images/localhost.png)


### Step 2: Routing to your web application using the traefik reverse proxy.

Usually, you don't want your service to run directly behind an open port. This is why, in this section, we configure the traefik reverse proxy to listen for HTTP and HTTPS requests on a certain domain to route these requests to our application internally.

*Step 2.1:* To make sure all the requests are TLS encrypted we use a redirection of traefik's entrypoints from port 80 (http) to 443 (https) in traefik's static configuration in the [yml](tutorial/2.%20Routing%20domain%20using%20Traefik/traefik.yml) file. To make traefik work with SSL certificates, we need to configure a certificate-resolver, which we call "le". For demo purposes we use a Let's Encrypt ca-server. Please mind that the acme.json has to be created before running docker-compose to ensure proper access:

`$ touch acme.json` 

`$ chmod 600 acme.json`

```yaml
entryPoints:
  web:
    address: ":80"
    http:
     redirections:
      entryPoint:
        to: websecure
        scheme: https
     
  websecure:
    address: ":443"
    
certificatesResolvers:
  le:
    acme:
      caServer: https://acme-staging-v02.api.letsencrypt.org/directory
      storage: acme.json
```

The traefik container will listen on ports 80 and 443, redirect all http trafic on port 80 to port 443 and tls-challenge it. 

Now the container ports have to be mapped to the host ports in the [docker-compose.yml](tutorial/2.%20Routing%20domain%20using%20Traefik/docker-compose.yml).

```yaml
services:
  traefik:
   ...
   ports:
     - "80:80"
     - "443:443"
```
Now all requests to the host port 80 go to traefik's port 80, same applies for port 443.
If no SSL certificates are given to traefik it will create default (and at first untrusted) certificates. Of course, in production mode a registered domain and real certificates are highly recommended!

*Step 2.2:* Configure the testpage service.

Traefik uses labels for its dynamic configuration with docker. We want the testpage service to listen to requests to the domain *testpage.mydomain.com* where mydomain.com represents your domain and testpage is the custom subdomain for our webpage.

```yaml
services:
  testpage:
   ...
   labels:
     - "traefik.http.routers.testpage.rule=Host(`testpage.mydomain.com`)"
```

This way, the traefik service knows that all requests to *testpage.mydomain.com* are rerouted to the testpage service. Since we disabled the *exposedByDefault* option in the yml file we have to tell traefik that it has to watch this service and its labels with an additional label:
You see that no port binding is needed anymore. The only open ports are 80 and 443 which are bound to traefik.

```yaml
services:
  testpage:
   ...
   labels:
     - "traefik.enable=true"
```
We choose our previously created resolver *le* to tell traefik which certificate-resolver it has to use for the testpage service in order to work with TLS encryption.

```yaml
services:
  testpage:
   ...
   labels:
     - "traefik.http.routers.testpage.tls.certresolver=le"
```

The only thing left: If you do not possess a registered domain you need to add an entry to your hostname file in /etc/hosts.

`$ echo "127.0.0.1       testpage.mydomain.com" >> /etc/hosts`

`$ echo "127.0.0.1       traefik.mydomain.com" >> /etc/hosts`

In the compose file you can see the rest of the configuration for the traefik service. It will listen to requests on *traefik.mydomain.com*.

*Step 2.3:* Run the services with `$ docker-compose up -d`.

*Step 2.4:* Open the browser and check whether we configured everything correctly. Try to reach the testpage via polling *testpage.mydomain.com* and traefik's dashboard via *traefik.mydomain.com/dashboard/*.

![Traefik Admin](tutorial/2.%20Routing%20domain%20using%20Traefik/images/traefik.png)

![Domain Web App](tutorial/2.%20Routing%20domain%20using%20Traefik/images/app.png)

### Step 3: Securing the Testpage using Gatekeeper.

In this section, [keycloak](https://www.keycloak.org/docs/latest/securing_apps/) [gatekeeper](https://www.keycloak.org/docs/latest/securing_apps/#_keycloak_generic_adapter) is used to secure the webpage. To achieve this we can authenticate users by challenging them with a login page and checking whether the user is known by our identity management (e.g. Keycloak). Any user properly registered in our identity management will be granted access that way. Of course if you want to protect a resource (our webpage) you might want to restrict access only to some special users. To do so we use authorization, which will determine whether the user is allowed to access our resource. So authentication and authorization are closely related but very different concepts. In short: Authentication verifies the identity of a user (most commonly by asking for a username and a password) and authorization is used to determine what the user is allowed to do after authentication is done. In this example Gatekeeper will take care of both aspects for us.

*Step 3.1:* First we need to include a gatekeeper service, which we call "gatekeeper_testpage" in the [docker-compose.yml](tutorial/3.%20Securing%20Testpage%20with%20Gatekeeper/docker-compose.yml) file. We add the official keycloak-gatekeeper image v7.0.0.

```yaml
services:
...
  gatekeeper_testpage: 
    image: keycloak/keycloak-gatekeeper:7.0.0
    volumes:
      - ./keycloak-gatekeeper.conf:/etc/keycloak-gatekeeper.conf
```

Gatekeeper is configured via the mounted [keycloak-gatekeeper.conf](tutorial/3.%20Securing%20Testpage%20with%20Gatekeeper/keycloak-gatekeeper.conf). Below you can find some snippets from that file. Please refer to the documentation for indepth information: [Keycloak Gatekeeper](https://www.keycloak.org/docs/latest/securing_apps/#_keycloak_generic_adapter)

```yaml
discovery-url: https://auth.n5geh.de/auth/realms/demo-realm
client-id: web_app_test
client-secret: 39da0b97-18d7-4314-914c-2316a9fb0b9a
listen: :3030
redirection-url: https://testpage.mydomain.com
upstream-url: http://testpage:8000
```

The *discovery-URL* is used to retrieve OpenID configurations. We provide a keycloak demo-realm for testing purposes. Please, use the given credentials for *client-id* and *client-secret*. *Listen* is used to describe the port at which the gatekeeper service listens, e.g. 3030. 

*Redirection-URL* is the host/site URL and has to match the redirection URL specified in the Keycloak client. *Upstream-URL* is the address where Gatekeeper is going to direct the users request to. In our case this is the docker-internal URL of our testpage. But it could be any valid and from Gatekeeper reachable URL.  

### Step 4: Securing Access to a Resource Using Roles and Groups

The above steps only offer limited security so far, since we did only implement authentication yet. But Gatekeeper is also able to provide access on several other conditions and allows us to define those in an easy way, also using the keycloak-gatekeeper.conf.

The most direct way to accomplish this is to add *resources* to the config. For example:

```yaml
resources:
- uri: /admin*
  methods:
  - GET
  roles:
  - admin_role
  - superuser_role
  require-any-role: true
  groups:
  - admins
  - users
- uri: /backend*
  roles:
  - admin_role
- uri: /public/*
  white-listed: true
- uri: /favicon
  white-listed: true
- uri: /css/*
  white-listed: true
- uri: /img/*
  white-listed: true
```

You might notice that resources are defined by an URI which is a sub-path of our upstream-URL. So for example to access http://testpage:8000/admin one of the roles specified is required and even permitted users can only perform GET requests on that resource. Also the user has to be a member of the specified groups. The '*' at the end of the sub-path is a wild-card so any sub-path beginning with /admin/ is protected. For other options like "methods: - POST" see the documentation linked above.

Besides defining resources there is also another method to restrict access to a resource, which is based on claims. Maybe you would like to restrict access to a resource by e-mail address. To do so you can use ["claim-matching"](https://www.keycloak.org/docs/latest/securing_apps/#claim-matching)  in the config file.

By using these methods you can easily provide additional authorization to your application.

### Step 5: Enable the Gatekeeper Service in Traefik

In the compose file we add labels to the *gatekeeper_testpage* service:
```
services:
  ...
  testpage:
    ...
    labels:
      - "traefik.enable=false" #redundant
  ...
  gatekeeper_testpage:
    ...
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.auth.rule=Host(`testpage.mydomain.com`)"
      - "traefik.http.routers.auth.tls.certresolver=le"
      - "traefik.http.services.auth.loadbalancer.server.port=3030"
      
```
We disabled traefik and deleted the host rule for the *testpage* service since we do not want it to be reachable directly. Instead, we included the same host rule for the *gatekeeper_testpage* service. So gatekeeper catches the requests, handles them accordingly and passes them to our testpage afterwards. It kind of sits in front of testpage.

Please mind that Gatekeeper can only have one upstream-URL. Additionally Gatekeeper has to be labeled to the domains root-path to work properly. **As a result you can't have multiple applications running in different docker-containers on different sub-paths of one domain!** You should consider using sub-domains for different applications when using Gatekeeper. 

*Step 5.1:* After everything has been configured run `$ docker-compose up -d`. The complete docker-compose file for securing the Testpage service using Gatekeeper can be found here [docker-compose.yml](tutorial/3.%20Securing%20Testpage%20with%20Gatekeeper/docker-compose.yml) for comparison.

*Step 5.2* Open the browser and try to access "testpage.mydomain.com", you can see that now gatekeeper redirects you to authentication page as shown below.

![Gatekeeper Login](tutorial/3.%20Securing%20Testpage%20with%20Gatekeeper/images/gatekeeper.png)

The demo credentials are   
username: demo-user  
pw: demo1  
After logging in successfully, the page is redirected back to redirect-url mentioned in the keycloak-gatekeeper.conf file. The traffic though is routed to the upstream-url!

![Successful Login](tutorial/3.%20Securing%20Testpage%20with%20Gatekeeper/images/app.png)



You can create and test different authorization rules by using the following users which we provided in the demo-realm:

**admin-user**

* Password: admin-user
* Roles: admin-user, employee-role
* Group: admin-user
* E-Mail: admin@acme.com

**normal-user**

* Password: normal-user
* Roles: normal-user, customer-role
* Group: normal-user
* E-Mail: normal@other-acme.com


# License
License: MIT Copyright (c) 2020 N5GEH

# Acknowledgement
<img src="https://www.ebc.eonerc.rwth-aachen.de/global/show_picture.asp?mod=w%3d474%26h%3d%26gray%3d%26neg%3d%26mirror%3d%26flip%3d%26rleft%3d%26rright%3d%26r180%3d%26crop%3d%26id%3daaaaaaaaaayxgwf&id=aaaaaaaaaayxgwf" width="250">

We gratefully acknowledge the financial support provided by the BMWi (Federal Ministry for Economic Affairs and Energy), promotional reference 03ET1561A/B/C
