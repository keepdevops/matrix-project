FROM ubuntu:22.04
RUN apt-get update && apt-get install -y build-essential cmake git libgomp1
RUN git clone https://github.com/ggerganov/llama.cpp /Users/Shared/models/llama.cpp
WORKDIR /Users/Shared/models/llama.cpp
RUN mkdir build && cd build &&     cmake .. -DLLAMA_NATIVE=OFF -DLLAMA_BUILD_SERVER=ON -DLLAMA_AVX=OFF -DLLAMA_AVX2=OFF -DLLAMA_FMA=OFF &&     cmake --build . --config Release -j 4
RUN ln -s /Users/Shared/models/llama.cpp/build/bin/llama-server /usr/local/bin/llama-server
WORKDIR /Users/Shared/models
ENTRYPOINT ["llama-server"]
