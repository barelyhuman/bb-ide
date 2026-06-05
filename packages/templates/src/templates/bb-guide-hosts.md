---
kind: instruction
title: bb Guide — Hosts
summary: Command reference for listing and understanding hosts.
intent: Provide complete host command documentation for agents.
editingNotes: Keep flags accurate against the CLI implementation.
---
Host commands

Hosts are where environments run.

- The supported host is the primary local daemon on the machine running bb.
- Host IDs remain part of the environment and project-source model so bb can
  keep that boundary clean for future expansion.

  bb host list                            List registered hosts with status

Host status values: connected, disconnected.
