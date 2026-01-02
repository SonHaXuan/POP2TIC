#include "App.h"
#include <string.h>
#include <stdlib.h>

// Global enclave ID
sgx_enclave_id_t global_eid = 0;
bool enclave_initialized = false;

#define ENCLAVE_FILE "enclave.signed.so"
#define MAX_STRING_LEN 4096

// ============================================================================
// Node.js Helper Functions
// ============================================================================

// Extract string from napi_value
std::string extractString(napi_env env, napi_value value) {
    size_t length = 0;
    napi_get_value_string_utf8(env, value, nullptr, 0, &length);
    char* buffer = new char[length + 1];
    napi_get_value_string_utf8(env, value, buffer, length + 1, &length);
    std::string result(buffer);
    delete[] buffer;
    return result;
}

// Create napi_value from string
napi_value createString(napi_env env, const char* str) {
    napi_value result;
    napi_create_string_utf8(env, str, NAPI_AUTO_LENGTH, &result);
    return result;
}

// ============================================================================
// SGX Enclave Management
// ============================================================================

// Initialize the SGX enclave
int initialize_enclave() {
    sgx_launch_token_t token = {0};
    int updated = 0;
    sgx_status_t ret = sgx_create_enclave(ENCLAVE_FILE, SGX_DEBUG_FLAG, &token, &updated, &global_eid, NULL);
    if (ret != SGX_SUCCESS) {
        return -1;
    }
    enclave_initialized = true;
    return 0;
}

// Destroy the SGX enclave
void destroy_enclave() {
    if (enclave_initialized) {
        sgx_destroy_enclave(global_eid);
        enclave_initialized = false;
        global_eid = 0;
    }
}

// ============================================================================
// Node.js API Functions
// ============================================================================

// InitializeEnclave: Initialize the SGX enclave
napi_value InitializeEnclave(napi_env env, napi_callback_info info) {
    size_t argc = 0;
    napi_value args[1];

    // Get arguments
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

    // Initialize enclave
    int result = initialize_enclave();

    // Return result as boolean
    napi_value jsResult;
    napi_get_boolean(env, result == 0, &jsResult);
    return jsResult;
}

// DestroyEnclave: Destroy the SGX enclave
napi_value DestroyEnclave(napi_env env, napi_callback_info info) {
    destroy_enclave();

    napi_value jsResult;
    napi_get_undefined(env, &jsResult);
    return jsResult;
}

// EvaluatePrivacy: Evaluate privacy compliance using SGX enclave
napi_value EvaluatePrivacy(napi_env env, napi_callback_info info) {
    size_t argc = 3;
    napi_value args[3];

    // Get arguments
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

    if (argc < 3) {
        napi_throw_error(env, nullptr, "Expected 3 arguments: appJson, userJson, policyJson");
        return nullptr;
    }

    // Extract JSON strings
    std::string appJson = extractString(env, args[0]);
    std::string userJson = extractString(env, args[1]);
    std::string policyJson = extractString(env, args[2]);

    // Prepare result buffer
    char result[MAX_STRING_LEN];
    memset(result, 0, sizeof(result));

    // Call enclave
    int ret = ecall_evaluate_privacy(
        global_eid,
        appJson.c_str(),
        userJson.c_str(),
        policyJson.c_str(),
        result,
        sizeof(result)
    );

    // Create return object
    napi_value obj;
    napi_create_object(env, &obj);

    napi_value success;
    napi_get_boolean(env, ret >= 0, &success);
    napi_set_named_property(env, obj, "success", success);

    napi_value resultStr = createString(env, result);
    napi_set_named_property(env, obj, "result", resultStr);

    napi_value retCode;
    napi_create_int32(env, ret, &retCode);
    napi_set_named_property(env, obj, "code", retCode);

    return obj;
}

// ============================================================================
// Module Initialization
// ============================================================================

// Init: Module entry point
napi_value Init(napi_env env, napi_value exports) {
    napi_value initializeFn;
    napi_create_function(env, "initializeEnclave", NAPI_AUTO_LENGTH,
                        InitializeEnclave, nullptr, &initializeFn);
    napi_set_named_property(env, exports, "initializeEnclave", initializeFn);

    napi_value destroyFn;
    napi_create_function(env, "destroyEnclave", NAPI_AUTO_LENGTH,
                        DestroyEnclave, nullptr, &destroyFn);
    napi_set_named_property(env, exports, "destroyEnclave", destroyFn);

    napi_value evaluateFn;
    napi_create_function(env, "evaluatePrivacy", NAPI_AUTO_LENGTH,
                        EvaluatePrivacy, nullptr, &evaluateFn);
    napi_set_named_property(env, exports, "evaluatePrivacy", evaluateFn);

    return exports;
}

// NAPI_MODULE_INIT - Called when module is loaded
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
