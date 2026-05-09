#include "httplib.h"
#include "matrix_env.h"
#include "proxy_routes.h"

#include <iostream>
#include <string>

int main(int /*argc*/, char* argv[]) {
    std::string proj_root = argv[0];
    if (auto sl = proj_root.rfind('/'); sl != std::string::npos)
        proj_root = proj_root.substr(0, sl);
    else proj_root = ".";

    matrix_env_init(proj_root);

    httplib::Server svr;
    svr.set_read_timeout(660, 0);
    svr.set_write_timeout(660, 0);

    register_proxy_routes(svr, proj_root);

    std::cout << "Matrix Proxy active on http://0.0.0.0:" << g_env.proxy_port << "\n";
    std::cout << "  MATRIX_MODEL_DIR=" << g_env.model_dir << "\n";
    std::cout << "  MATRIX_LLAMA_SERVER=" << g_env.llama_server_bin << "\n";
    svr.listen("0.0.0.0", g_env.proxy_port);
    return 0;
}
