# Security

Oberth runs on your Mac and can start processes in your project folders, so its security model matters even though it never leaves `127.0.0.1`. [docs/architecture.md](docs/architecture.md#security) describes it in full. In short:

- The service and the stable-address proxy listen on `127.0.0.1` only.
- Every request must carry Oberth's own Host header, which stops DNS-rebinding attacks from web pages.
- Anything that acts, and anything that returns code, logs, prompts or session titles, needs a random token stored in the state folder with owner-only permissions, plus an own or absent Origin.
- The API never accepts a command, a path or a process id it didn't hand out itself.
- The proxy forwards only to servers Oberth launched or found in a project folder, never to a port named in a request, and never launches anything.

It assumes one trusted person on the Mac. Other local users and malware running as you are outside what it defends against.

## Reporting a vulnerability

Please report it privately through this repository's **Security** tab (Report a vulnerability) rather than in a public issue. Include what an attacker needs (a web page you visit, another local process) and what they get. As with the rest of the project, there is no guaranteed response time, but security reports are read first.
