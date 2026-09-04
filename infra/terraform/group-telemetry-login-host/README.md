# Group telemetry login host

One stopped `t4g.nano` in the collector's fixed-egress private subnet. It exists because VRChat pins a session to the network address that created it: a session created on an operator's machine is refused from the collector, whatever address the collector uses (2026-09-04, three logins, `docs/planning/collector-session-reauth-research.md` section 4a). The collector's session therefore has to be created from behind the collector's own NAT gateway, and this host is how an operator gets there.

The host runs a loopback-only HTTP CONNECT proxy on port 8888 (`connect-proxy.sh`, applied as user data). Nothing listens on the network; the operator reaches the proxy with SSM port forwarding, and every tunnel it opens leaves through the collector's NAT gateway and Elastic IP. It has no SSH key and no permissions beyond `AmazonSSMManagedInstanceCore`.

Apply it by hand with the operator's credentials; it is not part of the collector release lane and changes about once a year. `terraform.yml` only validates it. The proxy is a systemd unit, so it survives the stop/start cycle; an edit to `connect-proxy.sh` replaces the host, because user data runs on first boot only.

## Recovery runbook

When the collector account is `auth_required`:

1. Start the host: `terraform apply -var-file=environments/production.tfvars -var running=true`, or `aws ec2 start-instances --instance-ids "$(terraform output -raw instance_id)"`. Wait until `aws ssm describe-instance-information` reports it `Online`.
2. Open the tunnel with the `port_forward_command` output. The Session Manager plugin must be installed. The session ends after the CLI's own timeout, so reopen it before submitting the login form if the login takes long.
3. From the VRDex checkout, with the proxy in the environment, log in and transfer:

   ```bash
   export NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:8888 HTTP_PROXY=http://127.0.0.1:8888 NO_PROXY=127.0.0.1,localhost
   pnpm proof:group-telemetry --fresh-login --duration-minutes=0 --login-timeout-minutes=30
   pnpm ops:vrchat-session:transfer --secret-id <account secret ARN>
   ```

   The login form stays local; only the VRChat requests go through the tunnel. Check the tunnel first with `curl -x http://127.0.0.1:8888 https://checkip.amazonaws.com`; it must print the collector's Elastic IP. The harness saves any cookie rotation from its final read back to the vault, so the transfer always validates the current session; run it straight after.
4. Re-register the account with the values the transfer prints (`vrchatUserId`, `workerKeyHash`, `secretRef`); this sets it `ready` and bumps the credential generation:

   ```bash
   pnpm cx prod run communityTelemetry:registerCollectorAccount '{"vrchatUserId":"<usr_... from the transfer output>","accountAlias":"<account alias, Oak in production>","secretRef":"<account secret ARN>","workerKeyHash":"<hash from the transfer output>"}'
   ```

5. Restart the collector so it loads the new secret: `aws ecs update-service --cluster vrdex-group-telemetry --service vrdex-group-telemetry --force-new-deployment`. Do not dispatch a release until that deployment has completed; two overlapping deployments make the release verify step fail.
6. Stop the host: apply with `running=false` (the default), or `aws ec2 stop-instances --instance-ids "$(terraform output -raw instance_id)"`.

Never create the session anywhere else. A laptop-born session validates on the laptop and dies on the collector's first request.
