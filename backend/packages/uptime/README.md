# Uptime

The model callable Uptime tool tells an adult which of the household's services are up or down. It reads the public status page of each Uptime Kuma instance the household added and never changes anything.

Actions: `status` gives one line per instance, `list` gives each monitor with its status and 24 hour uptime. The optional `name` narrows to monitors whose name contains it. The `instance` argument is offered only when the household has more than one Uptime Kuma. A Kuma that does not answer is named in the reply and never fails the answer for the others.

The conditional `uptimeAllowed` offer is registered by the virtual tool registry. The recipe is a fallback stub; the tool handler is the implementation.

## License

AGPL-3.0. See the repository LICENSE.
