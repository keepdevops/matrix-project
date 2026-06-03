#pragma once
#include "agent.h"
#include "httplib.h"
#include <memory>
#include <string>
#include <vector>

/** Remove leading/trailing whitespace and chat-template leakage markers. */
std::string strip_template_leakage(std::string s);

/** Initialise per-port concurrency semaphores from the agent roster. */
void init_port_concurrency(const std::vector<Agent>& agents);

/** Borrow an httplib::Client for `port`; returns it to the pool via checkin(). */
std::unique_ptr<httplib::Client> pool_checkout(int port, int read_timeout_secs);

/** Return a client to the pool after a successful (non-error) response. */
void pool_checkin(int port, std::unique_ptr<httplib::Client> cli);

/** Acquire the per-port concurrency semaphore for `port` (no-op if unlimited). */
void semaphore_acquire(int port);

/** Release the per-port semaphore and return whether waiters are queued. */
bool semaphore_release_has_waiters(int port);

/** Token-budget gate: block until estimated_tokens fit within the port KV budget. */
void semaphore_acquire_tokens(int port, int estimated_tokens);

/** Release actual_tokens from the in-flight budget (0 = no-op if budget disabled). */
void semaphore_release_tokens(int port, int actual_tokens);
