#include "Enclave.h"
#include "PrivacyEvaluation_edl.h"
#include "sgx_trts.h"
#include <string.h>
#include <cstring>

// Simple JSON parsing (without external library for SGX compatibility)
// For production, consider using a SGX-compatible JSON library

#define MAX_JSON_LEN 65536
#define MAX_NODES 256

// ============================================================================
// JSON Parsing Helpers (Minimal implementation for SGX)
// ============================================================================

static char* findJsonStr(char* json, const char* key) {
    char search[256];
    snprintf(search, sizeof(search), "\"%s\"", key);
    char* pos = strstr(json, search);
    if (!pos) return NULL;
    pos += strlen(search);
    while (*pos == ' ' || *pos == ':') pos++;
    return pos;
}

static int extractInt(char** pos) {
    while (**pos == ' ' || **pos == ':' || **pos == ',') (*pos)++;
    return atoi(*pos);
}

static void extractStr(char* pos, char* out, int maxLen) {
    while (*pos == ' ' || *pos == ':' || *pos == ',' || *pos == '"') pos++;
    if (*pos == '[') {
        // Array - skip for now (handled separately)
        out[0] = '\0';
        return;
    }
    if (*pos == '"') {
        pos++;
        int i = 0;
        while (*pos && *pos != '"' && i < maxLen - 1) {
            out[i++] = *pos++;
        }
        out[i] = '\0';
    }
}

static int extractStrArray(char* pos, char** arr, int maxCount) {
    int count = 0;
    while (*pos == ' ' || *pos == ':') pos++;
    if (*pos != '[') return 0;
    pos++; // skip '['

    while (*pos && *pos != ']' && count < maxCount) {
        while (*pos == ' ' || *pos == ',') pos++;
        if (*pos == '"') {
            pos++;
            int len = 0;
            char* start = pos;
            while (*pos && *pos != '"' && *pos != ',') {
                if (*pos == ']') break;
                pos++;
                len++;
            }
            if (len > 0) {
                arr[count] = (char*)malloc(len + 1);
                memcpy(arr[count], start, len);
                arr[count][len] = '\0';
                count++;
            }
            if (*pos == '"') pos++;
        } else {
            pos++;
        }
    }
    return count;
}

// ============================================================================
// JSON to Struct Parsers
// ============================================================================

bool parseAppJson(const char* json, AppRequest& app) {
    char buffer[MAX_JSON_LEN];
    strncpy(buffer, json, MAX_JSON_LEN);

    // Clear arrays
    app.attributes.clear();
    app.purposes.clear();
    app.timeofRetention = 0;

    // Parse timeofRetention
    char* pos = findJsonStr(buffer, "timeofRetention");
    if (pos) {
        app.timeofRetention = extractInt(&pos);
    }

    // For a production implementation, you would parse attributes/purposes arrays
    // This is a simplified version - the actual implementation would need proper
    // JSON parsing or use a SGX-compatible JSON library

    return true;
}

bool parseUserJson(const char* json, UserPreference& user) {
    char buffer[MAX_JSON_LEN];
    strncpy(buffer, json, MAX_JSON_LEN);

    // Clear arrays
    user.attributeIds.clear();
    user.exceptionIds.clear();
    user.denyAttributeIds.clear();
    user.allowedPurposeIds.clear();
    user.prohibitedPurposeIds.clear();
    user.denyPurposeIds.clear();
    user.timeofRetention = 0;

    // Parse timeofRetention
    char* pos = findJsonStr(buffer, "timeofRetention");
    if (pos) {
        user.timeofRetention = extractInt(&pos);
    }

    // Parse attribute arrays (simplified - would need proper JSON parser)
    // ...

    return true;
}

bool parsePolicyJson(const char* json, PolicyData& policy) {
    // Parse policy with attributes and purposes arrays
    // Simplified - would need proper JSON parser for production
    return true;
}

// ============================================================================
// Nested Set Model Helper
// ============================================================================

bool isDescendant(const PolicyNode& ancestor, const PolicyNode& descendant) {
    // Node A is an ancestor of Node B if:
    // A.left <= B.left AND A.right >= B.right
    return (ancestor.left <= descendant.left) && (ancestor.right >= descendant.right);
}

// ============================================================================
// Time of Retention Evaluation
// ============================================================================

bool evaluateTimeofRetention(const AppRequest& app, const UserPreference& userPref) {
    // Port of src/helpers/privacy-preference.helper.js:33-35
    // App retention time must be <= user's retention time
    return app.timeofRetention <= userPref.timeofRetention;
}

// ============================================================================
// Attribute Evaluation
// ============================================================================

bool evaluateAttributeType(
    const AppRequest& app,
    const UserPreference& userPref,
    const PolicyData& policy,
    const std::string& type
) {
    // Port of src/helpers/privacy-preference.helper.js:76-135
    std::vector<std::string>* uppAttributes = nullptr;

    switch (type == "allow" ? 1 : type == "except" ? 2 : type == "deny" ? 3 : 0) {
        case 1: // allow
            uppAttributes = const_cast<std::vector<std::string>*>(&userPref.attributeIds);
            break;
        case 2: // except
        case 3: // deny
            uppAttributes = const_cast<std::vector<std::string>*>(&userPref.exceptionIds);
            break;
        default:
            return false;
    }

    // Check each app attribute against user preference attributes
    for (const auto& appAttr : app.attributes) {
        // Find matching user preference attribute in policy
        for (const auto& userAttrId : *uppAttributes) {
            for (const auto& policyAttr : policy.attributes) {
                if (policyAttr.id == userAttrId) {
                    // Check nested set relationship
                    if (isDescendant(policyAttr, appAttr)) {
                        return true; // Found ancestor match
                    }
                }
            }
        }
    }

    return false;
}

bool evaluateAttributes(
    const AppRequest& app,
    const UserPreference& userPref,
    const PolicyData& policy
) {
    // Port of src/helpers/privacy-preference.helper.js:38-73
    // Check: allowed AND NOT excepted AND NOT denied

    bool isAllowed = evaluateAttributeType(app, userPref, policy, "allow");
    bool isExcepted = evaluateAttributeType(app, userPref, policy, "except");
    bool isDeny = evaluateAttributeType(app, userPref, policy, "deny");

    // Result: allowed AND NOT except AND NOT deny
    return isAllowed && !isExcepted && !isDeny;
}

// ============================================================================
// Purpose Evaluation
// ============================================================================

bool evaluatePurposeType(
    const AppRequest& app,
    const UserPreference& userPref,
    const PolicyData& policy,
    const std::string& type
) {
    // Port of src/helpers/privacy-preference.helper.js:176-228
    std::vector<std::string>* uppPurposes = nullptr;

    switch (type == "allow" ? 1 : type == "except" ? 2 : type == "deny" ? 3 : 0) {
        case 1: // allow
            uppPurposes = const_cast<std::vector<std::string>*>(&userPref.allowedPurposeIds);
            break;
        case 2: // except
        case 3: // deny
            uppPurposes = const_cast<std::vector<std::string>*>(&userPref.prohibitedPurposeIds);
            break;
        default:
            return false;
    }

    // Check each app purpose against user preference purposes
    for (const auto& appPurpose : app.purposes) {
        // Find matching user preference purpose in policy
        for (const auto& userPurposeId : *uppPurposes) {
            for (const auto& policyPurpose : policy.purposes) {
                if (policyPurpose.id == userPurposeId) {
                    // Check nested set relationship
                    if (isDescendant(policyPurpose, appPurpose)) {
                        return true; // Found ancestor match
                    }
                }
            }
        }
    }

    return false;
}

bool evaluatePurposes(
    const AppRequest& app,
    const UserPreference& userPref,
    const PolicyData& policy
) {
    // Port of src/helpers/privacy-preference.helper.js:138-173
    // Check: allowed AND NOT excepted AND NOT denied

    bool isAllowed = evaluatePurposeType(app, userPref, policy, "allow");
    bool isExcepted = evaluatePurposeType(app, userPref, policy, "except");
    bool isDeny = evaluatePurposeType(app, userPref, policy, "deny");

    // Result: allowed AND NOT except AND NOT deny
    return isAllowed && !isExcepted && !isDeny;
}

// ============================================================================
// Main Evaluation Function
// ============================================================================

EvaluationResult evaluate(
    const AppRequest& app,
    const UserPreference& userPref,
    const PolicyData& policy
) {
    // Port of src/helpers/privacy-preference.helper.js:4-30
    // All three checks must pass

    bool isAcceptedAttrs = evaluateAttributes(app, userPref, policy);
    bool isAcceptedPurposes = evaluatePurposes(app, userPref, policy);
    bool isTimeofRetention = evaluateTimeofRetention(app, userPref);

    // Return grant only if all checks pass
    if (isAcceptedAttrs && isAcceptedPurposes && isTimeofRetention) {
        return RESULT_GRANT;
    }
    return RESULT_DENY;
}

// ============================================================================
// ECALL Entry Point
// ============================================================================

int ecall_evaluate_privacy(
    const char* appJson,
    const char* userJson,
    const char* policyJson,
    char* result,
    size_t resultLen
) {
    // Parse JSON inputs
    AppRequest app;
    UserPreference user;
    PolicyData policy;

    if (!parseAppJson(appJson, app)) {
        strncpy(result, "error", resultLen);
        return RESULT_ERROR;
    }

    if (!parseUserJson(userJson, user)) {
        strncpy(result, "error", resultLen);
        return RESULT_ERROR;
    }

    if (!parsePolicyJson(policyJson, policy)) {
        strncpy(result, "error", resultLen);
        return RESULT_ERROR;
    }

    // Perform evaluation
    EvaluationResult evalResult = evaluate(app, user, policy);

    // Set result string
    if (evalResult == RESULT_GRANT) {
        strncpy(result, "grant", resultLen);
    } else if (evalResult == RESULT_DENY) {
        strncpy(result, "deny", resultLen);
    } else {
        strncpy(result, "error", resultLen);
    }

    return evalResult;
}
