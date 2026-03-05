#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <cstdlib>

const std::string VOLUME_PATH = "/data/history_log.txt";
const std::string MODEL_PATH = "/Users/Shared/models/model.gguf";

void save_to_history(const std::string& role, const std::string& content) {
    std::ofstream history_file(VOLUME_PATH, std::ios::app);
    if (history_file.is_open()) {
        history_file << "[" << role << "]: " << content << "\n";
        history_file << "-------------------------------------------\n";
        history_file.close();
    }
}

int main() {
    std::string user_input;
    std::cout << "C++ Agent Initialized. Type 'exit' to quit.\n";

    while (true) {
        std::cout << "\nPrompt > ";
        std::getline(std::cin, user_input);

        if (user_input == "exit") break;

        // 1. Log the prompt
        save_to_history("USER", user_input);

        // 2. Prepare the llama-cli command
        // Using llama-cli from shared models directory
        std::string command = "/Users/Shared/models/llama.cpp/build/bin/llama-cli -m " + MODEL_PATH + " -p \"" + user_input + "\" -n 256 --log-disable > temp_res.txt";
        
        // 3. Execute
        int status = std::system(command.c_str());

        // 4. Read response from temp file and log it
        std::ifstream temp_file("temp_res.txt");
        std::string response((std::istreambuf_iterator<char>(temp_file)), std::istreambuf_iterator<char>());
        
        std::cout << "\nResponse: " << response << std::endl;
        save_to_history("AGENT", response);
    }

    return 0;
}
