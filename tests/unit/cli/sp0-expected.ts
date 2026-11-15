/**
 * SP-0 pins (docs/design/second-provider.md 7, P-7 and P-8, CLI part), captured with sp0-pins.ts on
 * claude/workspace-policy 1307b21 (main with the SP-1 contract, before any provider change in src/cli).
 * The provider work must leave these as they are; changing one needs the PM's approval and a reason
 * (design 7). Volatile parts are marked by sp0-pins.ts normalize().
 */

export const SP0_EXPECTED: { readonly p7: Record<string, unknown>; readonly p8: Record<string, string> } = {
  "p7": {
    "task model and cap, defaults": {
      "run": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://api.anthropic.com",
          "requestTimeoutMs": 600000,
          "maxRetries": 2,
          "model": "claude-task",
          "maxOutputTokens": 100
        }
      },
      "list": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://api.anthropic.com",
          "requestTimeoutMs": 600000,
          "maxRetries": 2
        }
      },
      "connection": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://api.anthropic.com",
          "requestTimeoutMs": 600000,
          "maxRetries": 2
        }
      }
    },
    "env model over config model": {
      "run": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://api.anthropic.com",
          "requestTimeoutMs": 600000,
          "maxRetries": 2,
          "model": "claude-env",
          "maxOutputTokens": 200
        }
      },
      "list": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://api.anthropic.com",
          "requestTimeoutMs": 600000,
          "maxRetries": 2
        }
      },
      "connection": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://api.anthropic.com",
          "requestTimeoutMs": 600000,
          "maxRetries": 2
        }
      }
    },
    "task model over env model": {
      "run": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://api.anthropic.com",
          "requestTimeoutMs": 600000,
          "maxRetries": 2,
          "model": "claude-task",
          "maxOutputTokens": 200
        }
      },
      "list": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://api.anthropic.com",
          "requestTimeoutMs": 600000,
          "maxRetries": 2
        }
      },
      "connection": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://api.anthropic.com",
          "requestTimeoutMs": 600000,
          "maxRetries": 2
        }
      }
    },
    "config model, task cap over config cap": {
      "run": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://api.anthropic.com",
          "requestTimeoutMs": 600000,
          "maxRetries": 2,
          "model": "claude-config",
          "maxOutputTokens": 50
        }
      },
      "list": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://api.anthropic.com",
          "requestTimeoutMs": 600000,
          "maxRetries": 2
        }
      },
      "connection": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://api.anthropic.com",
          "requestTimeoutMs": 600000,
          "maxRetries": 2
        }
      }
    },
    "placeholder model in config": {
      "run": {
        "ok": false,
        "code": "provider_not_configured",
        "message": "not set: the model (task model.model, CODARYN_MODEL or config model): only a placeholder such as <model id> was found. Nothing was sent"
      },
      "list": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://api.anthropic.com",
          "requestTimeoutMs": 600000,
          "maxRetries": 2
        }
      },
      "connection": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://api.anthropic.com",
          "requestTimeoutMs": 600000,
          "maxRetries": 2
        }
      }
    },
    "no key, no model, no cap": {
      "run": {
        "ok": false,
        "code": "provider_not_configured",
        "message": "not set: ANTHROPIC_API_KEY; the model (task model.model, CODARYN_MODEL or config model); maxOutputTokens (task model.maxOutputTokens or config maxOutputTokens). Nothing was sent"
      },
      "list": {
        "ok": false,
        "code": "provider_not_configured",
        "message": "not set: ANTHROPIC_API_KEY. Nothing was sent"
      },
      "connection": null
    },
    "env address over config address": {
      "run": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://env.example/api",
          "requestTimeoutMs": 600000,
          "maxRetries": 2,
          "model": "m",
          "maxOutputTokens": 1
        }
      },
      "list": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://env.example/api",
          "requestTimeoutMs": 600000,
          "maxRetries": 2
        }
      },
      "connection": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://env.example/api",
          "requestTimeoutMs": 600000,
          "maxRetries": 2
        }
      }
    },
    "config address, timeout and retries": {
      "run": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://config.example",
          "requestTimeoutMs": 1234,
          "maxRetries": 0,
          "model": "m",
          "maxOutputTokens": 1
        }
      },
      "list": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://config.example",
          "requestTimeoutMs": 1234,
          "maxRetries": 0
        }
      },
      "connection": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "https://config.example",
          "requestTimeoutMs": 1234,
          "maxRetries": 0
        }
      }
    },
    "env address ending in /v1 refused": {
      "run": {
        "ok": false,
        "code": "invalid_config",
        "message": "CODARYN_API_BASE_URL must be an https URL (http only on a loopback host) without user info, query, fragment, spaces or backslashes, and must not end with /v1 (the API path is added)"
      },
      "list": {
        "ok": false,
        "code": "invalid_config",
        "message": "CODARYN_API_BASE_URL must be an https URL (http only on a loopback host) without user info, query, fragment, spaces or backslashes, and must not end with /v1 (the API path is added)"
      },
      "connection": {
        "ok": false,
        "code": "invalid_config",
        "message": "CODARYN_API_BASE_URL must be an https URL (http only on a loopback host) without user info, query, fragment, spaces or backslashes, and must not end with /v1 (the API path is added)"
      }
    },
    "env address over http refused": {
      "run": {
        "ok": false,
        "code": "invalid_config",
        "message": "CODARYN_API_BASE_URL must be an https URL (http only on a loopback host) without user info, query, fragment, spaces or backslashes, and must not end with /v1 (the API path is added)"
      },
      "list": {
        "ok": false,
        "code": "invalid_config",
        "message": "CODARYN_API_BASE_URL must be an https URL (http only on a loopback host) without user info, query, fragment, spaces or backslashes, and must not end with /v1 (the API path is added)"
      },
      "connection": {
        "ok": false,
        "code": "invalid_config",
        "message": "CODARYN_API_BASE_URL must be an https URL (http only on a loopback host) without user info, query, fragment, spaces or backslashes, and must not end with /v1 (the API path is added)"
      }
    },
    "loopback http address": {
      "run": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "http://127.0.0.1:9",
          "requestTimeoutMs": 600000,
          "maxRetries": 2,
          "model": "m",
          "maxOutputTokens": 1
        }
      },
      "list": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "http://127.0.0.1:9",
          "requestTimeoutMs": 600000,
          "maxRetries": 2
        }
      },
      "connection": {
        "ok": true,
        "settings": {
          "apiKey": "<key>",
          "apiBaseUrl": "http://127.0.0.1:9",
          "requestTimeoutMs": 600000,
          "maxRetries": 2
        }
      }
    }
  },
  "p8": {
    "doctor --json": "{\"schemaVersion\":1,\"kind\":\"doctor\",\"status\":\"ok\",\"exitCode\":0,\"checks\":[{\"id\":\"node_version\",\"status\":\"ok\",\"message\":\"Node.js 26 meets the requirement (26 or later)\",\"text\":{\"id\":\"doctor.node_version.ok\",\"params\":{\"major\":26,\"required\":26}}},{\"id\":\"config_file\",\"status\":\"ok\",\"message\":\"the config file is valid\",\"text\":{\"id\":\"doctor.config_file.valid_given\",\"params\":{\"location\":\"--config\"}}},{\"id\":\"vars_file\",\"status\":\"skipped\",\"message\":\"no --vars-file given\",\"text\":{\"id\":\"doctor.vars_file.skipped\"}},{\"id\":\"task_file\",\"status\":\"skipped\",\"message\":\"no --task given\",\"text\":{\"id\":\"doctor.task_file.skipped\"}},{\"id\":\"api_key\",\"status\":\"ok\",\"message\":\"ANTHROPIC_API_KEY is set; anthropic requests send it only to https://api.anthropic.com (the default address)\",\"text\":{\"id\":\"doctor.api_key.sends_to_default\",\"params\":{\"keyEnv\":\"ANTHROPIC_API_KEY\",\"provider\":\"anthropic\",\"origin\":\"https://api.anthropic.com\"}}},{\"id\":\"model\",\"status\":\"ok\",\"message\":\"the model and maxOutputTokens are set; whether the model exists is not checked (no network access); `codaryn models` lists the models the key can use\",\"text\":{\"id\":\"doctor.model.ok\"}},{\"id\":\"limits\",\"status\":\"ok\",\"message\":\"every limit is set for the quick form\",\"text\":{\"id\":\"doctor.limits.ok_quick\"}},{\"id\":\"file_locations\",\"status\":\"ok\",\"message\":\"1 input file(s) are outside the workspace\",\"text\":{\"id\":\"doctor.file_locations.ok\",\"params\":{\"count\":1}}},{\"id\":\"commands\",\"status\":\"skipped\",\"message\":\"no command is allowed and no command verifier is configured\",\"text\":{\"id\":\"doctor.commands.none\"}},{\"id\":\"workspace\",\"status\":\"ok\",\"message\":\"the workspace is an existing directory\",\"text\":{\"id\":\"doctor.workspace.ok\"}},{\"id\":\"install_dir\",\"status\":\"skipped\",\"message\":\"the install directory is not known in this environment\",\"text\":{\"id\":\"doctor.install_dir.unknown_env\"}},{\"id\":\"integrity_paths\",\"status\":\"skipped\",\"message\":\"integrity.paths is not set\",\"text\":{\"id\":\"doctor.integrity_paths.skipped\"}},{\"id\":\"language\",\"status\":\"skipped\",\"message\":\"the language selection is not connected in this build\",\"text\":{\"id\":\"doctor.language.unchecked\"}},{\"id\":\"lock\",\"status\":\"ok\",\"message\":\"no run holds the workspace lock\",\"text\":{\"id\":\"doctor.lock.none\"}}]}\n",
    "doctor text": "[ok]      Node.js version           Node.js 26 meets the requirement (26 or later)\n[ok]      config file               the config file given by --config is valid\n[skipped] variables file            no --vars-file given\n[skipped] task file                 no --task given\n[ok]      API key                   ANTHROPIC_API_KEY is set; anthropic requests send it to https://api.anthropic.com, the default address\n[ok]      model                     the model and maxOutputTokens are set; whether the model exists is not checked (no network access; codaryn models lists them)\n[ok]      limits                    every limit is set for the quick form\n[ok]      file locations            input files outside the workspace: 1\n[skipped] allowed commands          no command is allowed and no command check is configured\n[ok]      workspace                 the workspace is an existing directory\n[skipped] install directory         the install directory is not known in this environment\n[skipped] protected material paths  integrity.paths is not set\n[skipped] message language          the message language was not checked\n[ok]      workspace lock            no workspace lock file\n\ndoctor: ok (exit code 0). No network access was made and nothing was changed.\n",
    "models --json": "{\"schemaVersion\":1,\"kind\":\"models\",\"status\":\"listed\",\"exitCode\":0,\"models\":[{\"number\":1,\"id\":\"claude-pin-model\",\"displayName\":\"Pin Model\",\"createdAt\":\"2026-01-01T00:00:00Z\",\"maxInputTokens\":200000,\"maxOutputTokens\":64000},{\"number\":2,\"id\":\"claude-other\",\"displayName\":\"claude-other\",\"createdAt\":null,\"maxInputTokens\":null,\"maxOutputTokens\":null}],\"current\":{\"id\":\"claude-pin-model\",\"source\":\"config\",\"listed\":true},\"selected\":null}\n",
    "models text": "Models this key can use (2):\n\n  #  id                name          input tokens  output tokens\n* 1  claude-pin-model  Pin Model           200000          64000\n  2  claude-other      claude-other             -              -\n\n* current model (from the config file): claude-pin-model\n",
    "init --json": "{\"schemaVersion\":1,\"kind\":\"init\",\"status\":\"created\",\"exitCode\":0,\"config\":{\"source\":\"argument\",\"display\":\"--config\"},\"interactive\":false,\"model\":\"placeholder\",\"language\":null,\"commands\":0,\"protectedPaths\":0,\"keySet\":true,\"overriddenBy\":null}",
    "init file": "{\n  \"schemaVersion\": 1,\n  \"model\": \"<model id>\",\n  \"maxOutputTokens\": 4096,\n  \"limits\": {\n    \"maxModelTurns\": 12,\n    \"maxToolCalls\": 24,\n    \"maxTotalTokens\": 150000,\n    \"maxDurationMs\": 600000\n  },\n  \"policy\": {\n    \"commands\": [],\n    \"network\": \"deny\",\n    \"destructive\": \"deny\",\n    \"restorePathTokens\": false\n  }\n}\n",
    "run --json": "{\"schemaVersion\":1,\"kind\":\"run\",\"runId\":\"<runId>\",\"taskId\":\"quick\",\"status\":\"needs-input\",\"reason\":\"no_verifier\",\"exitCode\":3,\"provider\":\"anthropic\",\"verifiers\":[],\"changes\":[],\"usage\":{\"modelTurns\":1,\"toolCalls\":0,\"inputTokens\":100,\"outputTokens\":20,\"durationMs\":<ms>,\"repairAttempts\":0},\"journalPath\":\".codaryn/runs/<runId>/journal.jsonl\",\"notices\":[\"no automatic verification: no verifier is configured for this task\"],\"masking\":{\"registeredValues\":1,\"maskedPlaces\":0},\"finalMessage\":{\"text\":\"done\",\"truncated\":false}}",
    "run request": "[{\"method\":\"POST\",\"path\":\"/v1/messages\",\"body\":\"{\\\"model\\\":\\\"claude-pin-model\\\",\\\"max_tokens\\\":512,\\\"system\\\":\\\"You are Codaryn, a local task agent working inside one workspace directory.\\\\nUse the tools to read, search, change files and run allowed commands.\\\\nBefore changing a file, read it and pass the returned hash as expectedHash. Use null only for a new file.\\\\nSome text is replaced by protected placeholders: an uppercase label, a colon and 16 hex digits inside double square brackets.\\\\nKeep each placeholder exactly where it is. Never copy, move, alter or remove it. A line that holds a placeholder cannot be changed.\\\\nA denied tool call is final for that request. Do not try to work around it.\\\\nOnly the tools offered in this run exist.\\\\nYou cannot ask the person anything during the run. If something is unclear, take the most careful reading of the goal and say which one you took.\\\\nWhen the work is finished, reply without tool calls: what you changed, what you could not do and why, and what the person should check. Verifiers decide whether the task succeeded.\\\",\\\"messages\\\":[{\\\"role\\\":\\\"user\\\",\\\"content\\\":[{\\\"type\\\":\\\"text\\\",\\\"text\\\":\\\"say done\\\"}]}],\\\"tools\\\":[{\\\"name\\\":\\\"read_file\\\",\\\"description\\\":\\\"Read a UTF-8 text file in the workspace. Returns its content and its hash. Pass that hash as expectedHash when you change the file.\\\",\\\"input_schema\\\":{\\\"type\\\":\\\"object\\\",\\\"properties\\\":{\\\"path\\\":{\\\"type\\\":\\\"string\\\",\\\"minLength\\\":1,\\\"description\\\":\\\"Path relative to the workspace root.\\\"}},\\\"required\\\":[\\\"path\\\"],\\\"additionalProperties\\\":false}},{\\\"name\\\":\\\"search_files\\\",\\\"description\\\":\\\"List files and directories under a workspace directory, recursively. nameContains keeps paths that contain that literal string. text keeps files that contain that literal string and returns the matching lines.\\\",\\\"input_schema\\\":{\\\"type\\\":\\\"object\\\",\\\"properties\\\":{\\\"path\\\":{\\\"type\\\":\\\"string\\\",\\\"minLength\\\":1,\\\"description\\\":\\\"Directory relative to the workspace root. Use \\\\\\\".\\\\\\\" for the root.\\\"},\\\"nameContains\\\":{\\\"type\\\":\\\"string\\\"},\\\"text\\\":{\\\"type\\\":\\\"string\\\"}},\\\"required\\\":[\\\"path\\\"],\\\"additionalProperties\\\":false}},{\\\"name\\\":\\\"write_file\\\",\\\"description\\\":\\\"Create or change a UTF-8 text file in the workspace. expectedHash is the hash from your last read_file of this path, or null for a file that must not exist yet. The change either replaces the whole content or replaces one exact occurrence of oldText that appears only once.\\\",\\\"input_schema\\\":{\\\"type\\\":\\\"object\\\",\\\"properties\\\":{\\\"path\\\":{\\\"type\\\":\\\"string\\\",\\\"minLength\\\":1,\\\"description\\\":\\\"Path relative to the workspace root.\\\"},\\\"expectedHash\\\":{\\\"type\\\":[\\\"string\\\",\\\"null\\\"],\\\"pattern\\\":\\\"^[0-9a-f]{64}$\\\",\\\"description\\\":\\\"64 lowercase hex characters from read_file, or null for a new file.\\\"},\\\"change\\\":{\\\"anyOf\\\":[{\\\"type\\\":\\\"object\\\",\\\"properties\\\":{\\\"kind\\\":{\\\"const\\\":\\\"replace_all\\\"},\\\"content\\\":{\\\"type\\\":\\\"string\\\"}},\\\"required\\\":[\\\"kind\\\",\\\"content\\\"],\\\"additionalProperties\\\":false},{\\\"type\\\":\\\"object\\\",\\\"properties\\\":{\\\"kind\\\":{\\\"const\\\":\\\"replace_text\\\"},\\\"oldText\\\":{\\\"type\\\":\\\"string\\\",\\\"minLength\\\":1},\\\"newText\\\":{\\\"type\\\":\\\"string\\\"}},\\\"required\\\":[\\\"kind\\\",\\\"oldText\\\",\\\"newText\\\"],\\\"additionalProperties\\\":false}]}},\\\"required\\\":[\\\"path\\\",\\\"expectedHash\\\",\\\"change\\\"],\\\"additionalProperties\\\":false}},{\\\"name\\\":\\\"run_command\\\",\\\"description\\\":\\\"Run a program without a shell inside the workspace. Only commands the task policy allows will run. Returns the exit code, stdout and stderr.\\\",\\\"input_schema\\\":{\\\"type\\\":\\\"object\\\",\\\"properties\\\":{\\\"executable\\\":{\\\"type\\\":\\\"string\\\",\\\"minLength\\\":1},\\\"args\\\":{\\\"type\\\":\\\"array\\\",\\\"items\\\":{\\\"type\\\":\\\"string\\\"}},\\\"cwd\\\":{\\\"type\\\":\\\"string\\\",\\\"description\\\":\\\"Working directory relative to the workspace root. Default \\\\\\\".\\\\\\\".\\\"},\\\"timeoutMs\\\":{\\\"type\\\":\\\"integer\\\",\\\"minimum\\\":1,\\\"maximum\\\":600000}},\\\"required\\\":[\\\"executable\\\",\\\"args\\\"],\\\"additionalProperties\\\":false}}]}\"}]"
  }
};
