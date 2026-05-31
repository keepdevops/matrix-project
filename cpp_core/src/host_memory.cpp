#include "host_memory.h"

#include <cmath>

#if defined(__APPLE__)
#include <mach/mach.h>
#include <sys/sysctl.h>
#endif

json host_memory_snapshot() {
    json out = {
        {"ok", false},
        {"source", "host"},
        {"total_gb", nullptr},
        {"used_gb", nullptr},
        {"free_gb", nullptr},
    };

#if defined(__APPLE__)
    uint64_t total_bytes = 0;
    size_t len = sizeof(total_bytes);
    if (sysctlbyname("hw.memsize", &total_bytes, &len, nullptr, 0) != 0 || total_bytes == 0)
        return out;

    mach_port_t host = mach_host_self();
    vm_size_t page_size = 0;
    if (host_page_size(host, &page_size) != KERN_SUCCESS || page_size == 0)
        return out;

    vm_statistics64_data_t vm{};
    mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
    if (host_statistics64(host, HOST_VM_INFO64,
                          reinterpret_cast<host_info64_t>(&vm), &count) != KERN_SUCCESS)
        return out;

    const double page = static_cast<double>(page_size);
    const double avail = (static_cast<double>(vm.free_count)
                          + static_cast<double>(vm.inactive_count)
                          + static_cast<double>(vm.speculative_count)) * page;
    const double total = static_cast<double>(total_bytes);
    const double used = std::max(0.0, total - avail);
    const double free = std::max(0.0, avail);

    auto to_gb = [](double bytes) {
        return std::round(bytes / (1024.0 * 1024.0 * 1024.0) * 10.0) / 10.0;
    };

    out["ok"] = true;
    out["total_gb"] = to_gb(total);
    out["used_gb"] = to_gb(used);
    out["free_gb"] = to_gb(free);
#endif

    return out;
}
