output "instance_id" {
  value = aws_instance.host.id
}

output "port_forward_command" {
  description = "Opens local port 8888 onto the host's proxy. Needs the Session Manager plugin. The session ends after the CLI's own timeout; reopen it before submitting the login form."
  value       = "aws ssm start-session --target ${aws_instance.host.id} --document-name AWS-StartPortForwardingSession --parameters '{\"portNumber\":[\"8888\"],\"localPortNumber\":[\"8888\"]}'"
}
