/**
 * SP-0: the pinned results of sp0-scenarios.ts, computed once on main b05da45 (before SP-1
 * to SP-3). A change to any value here changes what the Anthropic adapter sends or returns: it needs
 * the PM's approval and a reason (docs/design/second-provider.md 7절).
 *
 * SP-3 (b) added `httpStatus` to the failures that are HTTP responses (ModelOutcome.httpStatus,
 * SP-1). Nothing else changed: without that field the values equal the ones computed on b05da45.
 *
 * DR-32 (b) (R-19 L-2) added the scenarios the first pins did not cover; their values were computed
 * on d086e04 and are the same on b05da45 without `httpStatus` (checked).
 *
 * DR-37 (a) changed three messages on purpose: a 401 or 403 now says only the fixed phrase and the
 * request id (p3Retries.unauthorized, p3Retries.forbidden, p6Models.errorOnSecondPage). Nothing else.
 * DR-68 (U-82) added `retryable` to every failure (ModelOutcome.retryable: the transport's verdict
 * for what was sent, the adapter's own for a malformed reply or a refusal). Nothing else changed:
 * without that key the values equal the ones pinned before (checked by a script in the U-82 report).
 */

export const SP0_GOLDEN: Record<string, unknown> = {
  "p1Bodies": {
    "basicAllTools": {
      "sha256": "1c01a32c5e081c6e4a78af2bde2ce341f307c5bd3fd959b2e0470d3399d1b9d1",
      "length": 2647
    },
    "noTools": {
      "sha256": "5075b1cbb7dd1750cfde58416542658ff403c33db8e3f43763853b6aede31737",
      "length": 149
    },
    "workflowTools": {
      "sha256": "ede08509d46120b184725384a408a688ca3bd4cb7b8558106be6f0d51e1afd53",
      "length": 2739
    },
    "toolRound": {
      "sha256": "0fbc2603d3e6deac3b12da8a999b85eea52023475519bdf6a1cd86bffc34fdda",
      "length": 3114
    },
    "sameRoleInARow": {
      "sha256": "5ee0f27769d0ee4d610d0483884db9e0baad143323b8ea98ea89e7ba55026bcd",
      "length": 2919
    },
    "maskedAndUnicode": {
      "sha256": "e02709ab814e8afad279a1876239978d39c007dcfbcc8e2de226f803612c0cb6",
      "length": 650
    },
    "emptySystem": {
      "sha256": "64535ab3f32eadb9bb35f9d95799cc917028508338929ed6ae86cc28325efb5c",
      "length": 1175
    },
    "assistantTextOnly": {
      "sha256": "9e75b8e8338f8b8b6a17767e279e52d5601927617f229207c495f782fdc24cef",
      "length": 2755
    },
    "longConversation": {
      "sha256": "3bd4b90491b245b19d4d3adf361c6a6fe77c85d36de8c2cace6d0d4a2326c01f",
      "length": 3839
    },
    "bigToolResult": {
      "sha256": "311bb08454ff78fc78675c7dc0319b651ffeabcdaf0a38de21e6c2e5e8f143ae",
      "length": 52885
    }
  },
  "p2RequestLine": {
    "messages": {
      "method": "POST",
      "url": "https://api.example.test/v1/messages",
      "redirect": "manual",
      "headers": [
        [
          "content-type",
          "application/json"
        ],
        [
          "x-api-key",
          "<key>"
        ],
        [
          "anthropic-version",
          "2026-10-21"
        ]
      ]
    },
    "models": {
      "method": "GET",
      "url": "https://api.example.test/v1/models?limit=1000",
      "redirect": "manual",
      "headers": [
        [
          "x-api-key",
          "<key>"
        ],
        [
          "anthropic-version",
          "2026-10-21"
        ]
      ]
    }
  },
  "p3Retries": {
    "rateLimitedThenOk": {
      "attempts": 2,
      "delays": [
        500
      ],
      "outcome": {
        "ok": true,
        "response": {
          "stop": "final",
          "text": "done",
          "toolCalls": [],
          "usage": {
            "inputTokens": 3,
            "outputTokens": 2
          }
        }
      }
    },
    "retryAfterSeconds": {
      "attempts": 2,
      "delays": [
        2000
      ],
      "outcome": {
        "ok": true,
        "response": {
          "stop": "final",
          "text": "done",
          "toolCalls": [],
          "usage": {
            "inputTokens": 3,
            "outputTokens": 2
          }
        }
      }
    },
    "retryAfterOverCap": {
      "attempts": 2,
      "delays": [
        60000
      ],
      "outcome": {
        "ok": true,
        "response": {
          "stop": "final",
          "text": "done",
          "toolCalls": [],
          "usage": {
            "inputTokens": 3,
            "outputTokens": 2
          }
        }
      }
    },
    "overloadedAlways": {
      "attempts": 4,
      "delays": [
        500,
        1000,
        2000
      ],
      "outcome": {
        "ok": false,
        "kind": "overloaded",
        "message": "HTTP 529 overloaded_error: busy (request req_011CAbCdEf) (after 4 attempts)",
        "httpStatus": 529,
        "retryable": true
      }
    },
    "unavailableThenServerError": {
      "attempts": 3,
      "delays": [
        500,
        1000
      ],
      "outcome": {
        "ok": true,
        "response": {
          "stop": "final",
          "text": "done",
          "toolCalls": [],
          "usage": {
            "inputTokens": 3,
            "outputTokens": 2
          }
        }
      }
    },
    "timeoutAndConflictStatuses": {
      "attempts": 3,
      "delays": [
        500,
        1000
      ],
      "outcome": {
        "ok": true,
        "response": {
          "stop": "final",
          "text": "done",
          "toolCalls": [],
          "usage": {
            "inputTokens": 3,
            "outputTokens": 2
          }
        }
      }
    },
    "unauthorized": {
      "attempts": 1,
      "delays": [],
      "outcome": {
        "ok": false,
        "kind": "auth_failed",
        "message": "HTTP 401: the key or its access was refused; the provider's message is not shown (request req_011CAbCdEf)",
        "httpStatus": 401,
        "retryable": false
      }
    },
    "forbidden": {
      "attempts": 1,
      "delays": [],
      "outcome": {
        "ok": false,
        "kind": "auth_failed",
        "message": "HTTP 403: the key or its access was refused; the provider's message is not shown (request req_011CAbCdEf)",
        "httpStatus": 403,
        "retryable": false
      }
    },
    "badRequest": {
      "attempts": 1,
      "delays": [],
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "HTTP 400 invalid_request_error: bad field (request req_011CAbCdEf)",
        "httpStatus": 400,
        "retryable": false
      }
    },
    "notFound": {
      "attempts": 1,
      "delays": [],
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "HTTP 404 not_found_error: model: test-model-id (request req_011CAbCdEf)",
        "httpStatus": 404,
        "retryable": false
      }
    },
    "serverErrorAlways": {
      "attempts": 4,
      "delays": [
        500,
        1000,
        2000
      ],
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "HTTP 500 api_error: boom (request req_011CAbCdEf) (after 4 attempts)",
        "httpStatus": 500,
        "retryable": true
      }
    },
    "connectionResetThenOk": {
      "attempts": 2,
      "delays": [
        500
      ],
      "outcome": {
        "ok": true,
        "response": {
          "stop": "final",
          "text": "done",
          "toolCalls": [],
          "usage": {
            "inputTokens": 3,
            "outputTokens": 2
          }
        }
      }
    },
    "connectionRefusedAlways": {
      "attempts": 4,
      "delays": [
        500,
        1000,
        2000
      ],
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "network error: connection failed (ECONNREFUSED) (after 4 attempts)",
        "retryable": true
      }
    },
    "tlsFailure": {
      "attempts": 1,
      "delays": [],
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "network error: TLS connection failed (CERT_HAS_EXPIRED)",
        "retryable": false
      }
    },
    "formatRefusal": {
      "attempts": 1,
      "delays": [],
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "the transport refused the request format (header, URL or port); nothing was sent",
        "retryable": false
      }
    },
    "unknownFailure": {
      "attempts": 1,
      "delays": [],
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "network error: unknown transport failure",
        "retryable": false
      }
    },
    "timeoutAlways": {
      "attempts": 2,
      "delays": [
        500
      ],
      "outcome": {
        "ok": false,
        "kind": "timeout",
        "message": "the request did not finish within 30 ms (after 2 attempts)",
        "retryable": true
      }
    },
    "redirect": {
      "attempts": 1,
      "delays": [],
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "HTTP 302: redirects are not followed, so the key is not sent elsewhere",
        "httpStatus": 302,
        "retryable": false
      }
    },
    "noRetriesAllowed": {
      "attempts": 1,
      "delays": [],
      "outcome": {
        "ok": false,
        "kind": "rate_limited",
        "message": "HTTP 429 rate_limit_error: slow down (request req_011CAbCdEf)",
        "httpStatus": 429,
        "retryable": true
      }
    },
    "badGatewayThenOk": {
      "attempts": 2,
      "delays": [
        500
      ],
      "outcome": {
        "ok": true,
        "response": {
          "stop": "final",
          "text": "done",
          "toolCalls": [],
          "usage": {
            "inputTokens": 3,
            "outputTokens": 2
          }
        }
      }
    },
    "gatewayTimeoutThenOk": {
      "attempts": 2,
      "delays": [
        500
      ],
      "outcome": {
        "ok": true,
        "response": {
          "stop": "final",
          "text": "done",
          "toolCalls": [],
          "usage": {
            "inputTokens": 3,
            "outputTokens": 2
          }
        }
      }
    },
    "payloadTooLarge": {
      "attempts": 1,
      "delays": [],
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "HTTP 413 request_too_large: too big (request req_011CAbCdEf)",
        "httpStatus": 413,
        "retryable": false
      }
    },
    "unprocessable": {
      "attempts": 1,
      "delays": [],
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "HTTP 422 invalid_request_error: cannot process (request req_011CAbCdEf)",
        "httpStatus": 422,
        "retryable": false
      }
    },
    "retryAfterPastDate": {
      "attempts": 2,
      "delays": [
        0
      ],
      "outcome": {
        "ok": true,
        "response": {
          "stop": "final",
          "text": "done",
          "toolCalls": [],
          "usage": {
            "inputTokens": 3,
            "outputTokens": 2
          }
        }
      }
    },
    "retryAfterFarFutureDate": {
      "attempts": 2,
      "delays": [
        60000
      ],
      "outcome": {
        "ok": true,
        "response": {
          "stop": "final",
          "text": "done",
          "toolCalls": [],
          "usage": {
            "inputTokens": 3,
            "outputTokens": 2
          }
        }
      }
    },
    "retryAfterFraction": {
      "attempts": 2,
      "delays": [
        1500
      ],
      "outcome": {
        "ok": true,
        "response": {
          "stop": "final",
          "text": "done",
          "toolCalls": [],
          "usage": {
            "inputTokens": 3,
            "outputTokens": 2
          }
        }
      }
    },
    "backoffReachesCap": {
      "attempts": 8,
      "delays": [
        500,
        1000,
        2000,
        4000,
        8000,
        8000,
        8000
      ],
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "HTTP 500 api_error: boom (request req_011CAbCdEf) (after 8 attempts)",
        "httpStatus": 500,
        "retryable": true
      }
    }
  },
  "p4Errors": {
    "jsonWithKeyShapes": {
      "attempts": 1,
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "HTTP 400 invalid_request_error: bad key [redacted] (request req_011CAbCdEf)",
        "httpStatus": 400,
        "retryable": false
      }
    },
    "jsonLongMessage": {
      "attempts": 1,
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "HTTP 400 invalid_request_error: word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word ...",
        "httpStatus": 400,
        "retryable": false
      }
    },
    "jsonOddType": {
      "attempts": 1,
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "HTTP 400: m",
        "httpStatus": 400,
        "retryable": false
      }
    },
    "htmlBody": {
      "attempts": 1,
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "HTTP 502 (the error body is not a JSON error object and is not shown)",
        "httpStatus": 502,
        "retryable": true
      }
    },
    "emptyBody": {
      "attempts": 1,
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "HTTP 500",
        "httpStatus": 500,
        "retryable": true
      }
    },
    "hugeBody": {
      "attempts": 1,
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "HTTP 400 (the error body is longer than 4096 bytes and is not shown)",
        "httpStatus": 400,
        "retryable": false
      }
    },
    "successNotJson": {
      "attempts": 1,
      "outcome": {
        "ok": false,
        "kind": "malformed_response",
        "message": "malformed response: the body is not JSON",
        "retryable": false
      }
    },
    "successWrongShape": {
      "attempts": 1,
      "outcome": {
        "ok": false,
        "kind": "malformed_response",
        "message": "malformed response: unexpected stop_reason undefined",
        "retryable": false
      }
    },
    "keyFragmentAndSpacedKey": {
      "attempts": 1,
      "outcome": {
        "ok": false,
        "kind": "api_error",
        "message": "HTTP 400 invalid_request_error: piec[redacted] and spaced [redacted] end (request req_011CAbCdEf)",
        "httpStatus": 400,
        "retryable": false
      }
    },
    "successOverLimit": {
      "attempts": 1,
      "outcome": {
        "ok": false,
        "kind": "malformed_response",
        "message": "malformed response: the response body is larger than 8388608 bytes",
        "retryable": false
      }
    }
  },
  "p5Responses": {
    "textFinal": {
      "ok": true,
      "response": {
        "stop": "final",
        "text": "all done",
        "toolCalls": [],
        "usage": {
          "inputTokens": 3,
          "outputTokens": 2
        }
      }
    },
    "usageWithCache": {
      "ok": true,
      "response": {
        "stop": "final",
        "text": "ok",
        "toolCalls": [],
        "usage": {
          "inputTokens": 117,
          "outputTokens": 5
        }
      }
    },
    "usageMissing": {
      "ok": true,
      "response": {
        "stop": "final",
        "text": "ok",
        "toolCalls": [],
        "usage": null
      }
    },
    "toolUse": {
      "ok": true,
      "response": {
        "stop": "tool_calls",
        "text": "Reading.",
        "toolCalls": [
          {
            "id": "toolu_01",
            "name": "read_file",
            "args": {
              "path": "a.txt"
            }
          },
          {
            "id": "toolu_02",
            "name": "search_files",
            "args": {
              "query": "x",
              "mode": "text"
            }
          }
        ],
        "usage": {
          "inputTokens": 3,
          "outputTokens": 2
        }
      }
    },
    "maxTokens": {
      "ok": true,
      "response": {
        "stop": "length",
        "text": "cut",
        "toolCalls": [],
        "usage": {
          "inputTokens": 3,
          "outputTokens": 2
        }
      }
    },
    "refusal": {
      "ok": false,
      "kind": "api_error",
      "message": "the model declined the request (stop_reason refusal)",
      "retryable": false
    },
    "thinkingDropped": {
      "ok": true,
      "response": {
        "stop": "final",
        "text": "visible",
        "toolCalls": [],
        "usage": {
          "inputTokens": 3,
          "outputTokens": 2
        }
      }
    },
    "stopSequence": {
      "ok": true,
      "response": {
        "stop": "final",
        "text": "stopped",
        "toolCalls": [],
        "usage": {
          "inputTokens": 3,
          "outputTokens": 2
        }
      }
    },
    "unknownStop": {
      "ok": false,
      "kind": "malformed_response",
      "message": "malformed response: unexpected stop_reason \"something_new\"",
      "retryable": false
    },
    "nullStop": {
      "ok": false,
      "kind": "malformed_response",
      "message": "malformed response: unexpected stop_reason null",
      "retryable": false
    },
    "toolUseBadInput": {
      "ok": false,
      "kind": "malformed_response",
      "message": "malformed response: tool_use block 0 input is not an object",
      "retryable": false
    }
  },
  "p6Models": {
    "twoPages": {
      "urls": [
        "GET https://api.example.test/v1/models?limit=1000",
        "GET https://api.example.test/v1/models?limit=1000&after_id=m-2"
      ],
      "outcome": {
        "ok": true,
        "models": [
          {
            "id": "m-1",
            "displayName": "Model m-1",
            "createdAt": "2026-01-02T03:04:05Z",
            "maxInputTokens": 200000,
            "maxOutputTokens": 64000
          },
          {
            "id": "m-2",
            "displayName": "Model m-2",
            "createdAt": "2026-01-02T03:04:05Z",
            "maxInputTokens": 200000,
            "maxOutputTokens": 64000
          },
          {
            "id": "m-3",
            "displayName": "m-3",
            "createdAt": null,
            "maxInputTokens": null,
            "maxOutputTokens": null
          }
        ]
      }
    },
    "errorOnSecondPage": {
      "urls": [
        "GET https://api.example.test/v1/models?limit=1000",
        "GET https://api.example.test/v1/models?limit=1000&after_id=m-1"
      ],
      "outcome": {
        "ok": false,
        "kind": "auth_failed",
        "message": "HTTP 401: the key or its access was refused; the provider's message is not shown (request req_011CAbCdEf) (page 2)",
        "httpStatus": 401,
        "retryable": false
      }
    },
    "entryWithoutId": {
      "urls": [
        "GET https://api.example.test/v1/models?limit=1000"
      ],
      "outcome": {
        "ok": false,
        "kind": "malformed_response",
        "message": "malformed response: entry 0 has no string id",
        "retryable": false
      }
    },
    "empty": {
      "urls": [
        "GET https://api.example.test/v1/models?limit=1000"
      ],
      "outcome": {
        "ok": true,
        "models": []
      }
    }
  }
};
