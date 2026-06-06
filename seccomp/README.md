# Hardened Seccomp Profile for Rootless Podman

`hardened-podman.json` is a deny-list seccomp profile for Podman code-execution containers. It allows all syscalls by default (`SCMP_ACT_ALLOW`) and explicitly blocks **66 dangerous syscalls** with `SCMP_ACT_ERRNO`.

## Syscalls Blocked

| Category | Syscalls |
|---|---|
| Kernel loading | `kexec_load`, `kexec_file_load`, `create_module`, `init_module`, `finit_module`, `delete_module`, `query_module` |
| Filesystem mounting | `mount`, `umount`, `umount2`, `pivot_root`, `chroot` |
| Process tracing | `ptrace`, `process_vm_readv`, `process_vm_writev`, `process_madvise` |
| Kernel monitoring | `perf_event_open`, `bpf`, `lookup_dcookie`, `kcmp` |
| Async I/O (io_uring) | `io_uring_setup`, `io_uring_enter`, `io_uring_register` |
| Filesystem events | `fanotify_init`, `fanotify_mark` |
| Namespace manipulation | `unshare`, `setns` |
| System identity | `sethostname`, `setdomainname` |
| System operations | `reboot`, `swapon`, `swapoff`, `syslog`, `sysfs` |
| Memory manipulation | `userfaultfd`, `vmsplice`, `modify_ldt`, `mbind`, `migrate_pages`, `move_pages`, `set_mempolicy` |
| Capability escalation | `capset`, `seccomp`, `personality` |

## Deployment

Copy the profile to the Oracle VM and set the env var:

```bash
# Copy profile to VM
scp hardened-podman.json opc@<oracle-vm-host>:/home/opc/seccomp/

# Set environment variable
export ORACLE_VM_PODMAN_SECCOMP=/home/opc/seccomp/hardened-podman.json
```

Then restart the service. All new Podman sessions will apply the profile automatically.

## Trade-offs

- **`personality`**: Blocking this syscall prevents cross-architecture execution (e.g., `gcc -m32`) and affects some JIT compilers. If you encounter `Operation not permitted` from build tools, remove `personality` from the blocked list and create a custom profile.
- **`userfaultfd`**: Blocked because it has been used in container escape exploits. Some memory-intensive applications may rely on it for user-space page fault handling — unblock if needed.
- **`unshare`/`setns`**: Blocked to prevent namespace manipulation inside the container. Tools like `bubblewrap` or `flatpak` run inside the container will fail — acceptable for code-execution containers.

## Related

See `buildRootlessPodmanCommands()` in `lib/terminal/oracle-vm-isolation.ts` for the integration code that reads `ORACLE_VM_PODMAN_SECCOMP`.
