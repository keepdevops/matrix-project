#include "mode.h"
#include "pipeline_run.h"

namespace {

struct Register {
    Register() {
        modes::register_mode({
            "pipeline",
            "Sequential chain — each agent receives the previous agent's output.",
            modes::run_pipeline_mode
        });
    }
} _reg;

}  // namespace
