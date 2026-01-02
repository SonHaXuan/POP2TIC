#ifndef ENCLAVE_H
#define ENCLAVE_H

#include <stdint.h>
#include <stdbool.h>
#include <string>
#include <vector>
#include <map>

// Policy node structure for nested set model
struct PolicyNode {
    std::string id;
    std::string name;
    int left;
    int right;
};

// App request data
struct AppRequest {
    std::vector<PolicyNode> attributes;
    std::vector<PolicyNode> purposes;
    int timeofRetention;
};

// User privacy preference
struct UserPreference {
    std::vector<std::string> attributeIds;      // allowed attributes
    std::vector<std::string> exceptionIds;      // exception attributes
    std::vector<std::string> denyAttributeIds;  // denied attributes

    std::vector<std::string> allowedPurposeIds;     // allowed purposes
    std::vector<std::string> prohibitedPurposeIds;  // prohibited purposes
    std::vector<std::string> denyPurposeIds;        // denied purposes

    int timeofRetention;
};

// Policy data (hierarchical attributes and purposes)
struct PolicyData {
    std::vector<PolicyNode> attributes;
    std::vector<PolicyNode> purposes;
};

// Evaluation result
enum EvaluationResult {
    RESULT_GRANT = 1,
    RESULT_DENY = 0,
    RESULT_ERROR = -1
};

// Enclave functions
int evaluate_privacy(
    const char* appJson,
    const char* userJson,
    const char* policyJson,
    char* result,
    size_t resultLen
);

// Core evaluation functions (ported from privacy-preference.helper.js)
EvaluationResult evaluate(
    const AppRequest& app,
    const UserPreference& userPref,
    const PolicyData& policy
);

bool evaluateAttributes(
    const AppRequest& app,
    const UserPreference& userPref,
    const PolicyData& policy
);

bool evaluateAttributeType(
    const AppRequest& app,
    const UserPreference& userPref,
    const PolicyData& policy,
    const std::string& type
);

bool evaluatePurposes(
    const AppRequest& app,
    const UserPreference& userPref,
    const PolicyData& policy
);

bool evaluatePurposeType(
    const AppRequest& app,
    const UserPreference& userPref,
    const PolicyData& policy,
    const std::string& type
);

bool evaluateTimeofRetention(
    const AppRequest& app,
    const UserPreference& userPref
);

// Nested set model helper
bool isDescendant(const PolicyNode& ancestor, const PolicyNode& descendant);

// JSON parsing helpers
bool parseAppJson(const char* json, AppRequest& app);
bool parseUserJson(const char* json, UserPreference& user);
bool parsePolicyJson(const char* json, PolicyData& policy);

#endif // ENCLAVE_H
