#ifndef APP_H
#define APP_H

#include <node_api.h>
#include "sgx_urts.h"
#include "../enclave/Enclave.h"

// SGX Enclave ID and other globals
extern sgx_enclave_id_t global_eid;
extern bool enclave_initialized;

// Node.js addon functions
napi_value InitializeEnclave(napi_env env, napi_callback_info info);
napi_value EvaluatePrivacy(napi_env env, napi_callback_info info);
napi_value DestroyEnclave(napi_env env, napi_callback_info info);

// Module registration
napi_value Init(napi_env env, napi_value exports);

// Enclave management
int initialize_enclave();
void destroy_enclave();

#endif // APP_H
