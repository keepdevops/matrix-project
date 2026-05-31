#pragma once
#include "httplib.h"
#include <memory>

/** Borrow a long-lived httplib::Client for SSE streaming on `port`. */
std::unique_ptr<httplib::Client> stream_pool_checkout(int port, int read_timeout_secs);

/** Return a healthy streaming client to the pool after a completed stream. */
void stream_pool_checkin(int port, std::unique_ptr<httplib::Client> cli);
