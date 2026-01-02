{
  "targets": [
    {
      "target_name": "sgx-addon",
      "sources": [
        "app/App.cpp",
        "app/App.h",
        "enclave/Enclave.cpp",
        "enclave/Enclave.h",
        "enclave/Edl/PrivacyEvaluation_edl.c",
        "enclave/Edl/PrivacyEvaluation_u.c",
        "enclave/Edl/PrivacyEvaluation_t.c"
      ],
      "include_dirs": [
        "<!(node -e \"require('nan')\")",
        "/opt/intel/sgxsdk/include",
        "enclave",
        "app"
      ],
      "libraries": [
        "-lsgx_urts",
        "-lsgx_uae_service",
        "-L/opt/intel/sgxsdk/lib64"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        [
          "OS=='linux'",
          {
            "cflags": [ "-fPIC" ],
            "cflags_cc": [ "-fPIC", "-std=c++17" ]
          }
        ]
      ]
    }
  ]
}
