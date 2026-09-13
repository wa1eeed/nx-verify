/**
 * Example answers from the data source's published specification, as recorded.
 *
 * They are what the sandbox answers with when no sandbox connection to the data source is
 * configured, and what the adapter's tests read. Kept verbatim so a mapping that reads
 * them correctly reads the real thing correctly: the values are the specification's own
 * test data and name nobody real.
 */

export const CORPORATE_FULL: Record<string, unknown> = {
  "status": "OK",
  "results_id": "0f79abdf-fa89-93a3-8b9c-40a3b6dc2b3a",
  "message": "Data successfully retrieved",
  "timestamp": "2024-10-24T15:37:35.254Z",
  "meta": null,
  "status_detail": null,
  "verifications": {
    "contract_copy_number": null,
    "contract_date": null,
    "commercial_registry": {
      "national_number": "1010711252",
      "registration_number": "7001272184",
      "version_number": 1
    },
    "company_name": {
      "ar": "شركة اختبار للتجارة",
      "en": null
    },
    "name_language": {
      "id": 1,
      "description": {
        "ar": "العربية",
        "en": null
      }
    },
    "commercial_registration_capital": 150000,
    "days_since_company_established": 99,
    "main_commercial_registry": {
      "is_main": false,
      "national_number": null,
      "registration_number": null
    },
    "issue_date": {
      "gregorian": "2002-10-05",
      "hijri": "1423-07-28"
    },
    "in_liquidation_process": false,
    "has_e_commerce": true,
    "headquarters": {
      "city_id": 1,
      "city_name": {
        "ar": "الرياض",
        "en": null
      }
    },
    "license": {
      "is_license_based": false,
      "issuer_national_number": "123456789",
      "issuer_name": {
        "ar": "xx",
        "en": null
      }
    },
    "partners": {
      "nationality_id": 1,
      "nationality": {
        "ar": "السعودية",
        "en": null
      }
    },
    "entity_type": {
      "id": 1,
      "name": {
        "ar": "شركة ذات مسؤولية محدودة",
        "en": null
      },
      "form_id": 1,
      "form_name": {
        "ar": "ذات مسؤولية محدودة",
        "en": null
      },
      "characters": [
        {
          "id": 3,
          "ar": "غير ربحية خاصة",
          "en": null
        }
      ]
    },
    "status": {
      "id": 1,
      "ar": "فعال",
      "en": null
    },
    "confirmation_date": {
      "gregorian": "2003-10-05",
      "hijri": "1424-07-28"
    },
    "reactivation_date": {
      "gregorian": "2023-03-10",
      "hijri": "1444-08-18"
    },
    "suspension_date": {
      "gregorian": "2022-12-05",
      "hijri": "1444-04-11"
    },
    "deletion_date": {
      "gregorian": "2024-07-20",
      "hijri": "1445-01-13"
    },
    "contact_info": {
      "phone_number": "011256398",
      "mobile_number": "050111101",
      "email": "TestEmail@mail.com",
      "website_url": "www.google.com"
    },
    "e_commerce": {
      "e_store": [
        {
          "authentication_platform_url": "www.google.com",
          "store_url": "www.google.com",
          "store_activities": [
            {
              "id": "476201",
              "ar": "صناعة زبدة المكسرات",
              "en": null
            }
          ]
        }
      ]
    },
    "capital_information": {
      "currency_id": 1,
      "currency": {
        "ar": "ريال سعودي",
        "en": null
      },
      "contribution_capital": {
        "type_id": 1,
        "type": {
          "ar": "نقدي و عيني",
          "en": null
        },
        "cash_capital": 75000,
        "in_kind_capital": 75000,
        "contribution_value": 100,
        "total_cash_contribution": 750,
        "total_in_kind_contribution": 750
      },
      "stock_capital": {
        "type_id": 2,
        "type": {
          "ar": "xx",
          "en": null
        },
        "capital": 12000,
        "announced_capital": 1244,
        "paid_capital": 12333,
        "cash_capital": 1111,
        "in_kind_capital": 111,
        "stocks": [
          {
            "count": 11,
            "value": 12,
            "type_id": 2,
            "type": {
              "ar": "xx",
              "en": null
            },
            "class_reference_id": 1,
            "class_name": {
              "ar": "xx",
              "en": null
            }
          }
        ]
      }
    },
    "fiscal_year": {
      "is_first": true,
      "calendar_type_id": 1,
      "calendar_type": {
        "ar": "ميلادي",
        "en": null
      },
      "end_month": 12,
      "end_day": 30,
      "end_year": null
    },
    "parties": [
      {
        "name": {
          "ar": "السيد عبدالعزيز احمد خالد الثنيان",
          "en": null
        },
        "type_id": 11,
        "type": {
          "ar": "جمعية خيرية/ مؤسسة أهلية",
          "en": null
        },
        "identity": {
          "id": "1234567890",
          "type_id": 1,
          "type": {
            "ar": "هوية وطنية",
            "en": null
          }
        },
        "partnership": [
          {
            "id": 8,
            "ar": "عضو",
            "en": null
          }
        ],
        "partner_share": {
          "cash_contribution_count": 250,
          "in_kind_contribution_count": 250,
          "total_contribution_count": 500
        },
        "nationality": null,
        "license_number": null,
        "commercial_registration_number": null,
        "partner_profit_loss_distribution": null,
        "guardian": null
      }
    ],
    "management": {
      "structure_id": 3,
      "structure_name": {
        "ar": "مجلس مديرين",
        "en": null
      },
      "dismissal_method": null,
      "managers": [
        {
          "name": {
            "ar": "السيد عبدالعزيز احمد خالد الثنيان",
            "en": null
          },
          "type_id": 1,
          "type": {
            "ar": "سعودي",
            "en": null
          },
          "is_licensed": true,
          "identity": {
            "id": "1234567890",
            "type_id": 1,
            "type": {
              "ar": "هوية وطنية",
              "en": null
            }
          },
          "nationality": {
            "id": 113,
            "type": {
              "ar": "سعودي",
              "en": null
            }
          },
          "positions": [
            {
              "id": 8,
              "ar": "عضو",
              "en": null
            }
          ]
        }
      ],
      "management_board": null,
      "directors_board": null
    },
    "liquidators": [
      {
        "name": {
          "ar": "عبدالله سالم هليل الشمري",
          "en": null
        },
        "type_id": 1,
        "type": {
          "ar": "فرد سعودي",
          "en": null
        },
        "identity": {
          "id": "2345678901",
          "type_id": 1,
          "type": {
            "ar": "هوية وطنية",
            "en": null
          }
        },
        "nationality": {
          "id": 113,
          "type": {
            "ar": "سعودي",
            "en": null
          }
        },
        "positions": [
          {
            "id": 8,
            "ar": "عضو",
            "en": null
          }
        ]
      }
    ],
    "activities": [
      {
        "id": "162910",
        "ar": "أنشطة أخرى خاصة بصناعة نشر الأخشاب",
        "en": null
      },
      {
        "id": "477340",
        "ar": "صناعة السلالم والدرابزينات",
        "en": null
      }
    ],
    "notification_channel": null,
    "partner_decision": null,
    "additional_decision_text": null,
    "set_aside_details": null,
    "articles": null,
    "additional_articles": null,
    "addresses": null
  }
};

export const CORPORATE_CONTRACT: Record<string, unknown> = {
  "status": "OK",
  "results_id": "0f79abdf-fa89-93a3-8b9c-40a3b6dc2b3a",
  "message": "Data successfully retrieved",
  "timestamp": "2024-10-24T15:37:35.254Z",
  "meta": null,
  "status_detail": null,
  "verifications": {
    "contract_copy_number": 1,
    "contract_date": "2025-02-23",
    "commercial_registry": {
      "national_number": "1010711252",
      "registration_number": "7001272184",
      "version_number": 1
    },
    "company_name": {
      "ar": "شركة اختبار للتجارة",
      "en": null
    },
    "name_language": {
      "id": 1,
      "description": {
        "ar": "العربية",
        "en": null
      }
    },
    "commercial_registration_capital": 150000,
    "days_since_company_established": 99,
    "main_commercial_registry": {
      "is_main": false,
      "national_number": null,
      "registration_number": null
    },
    "issue_date": {
      "gregorian": "2002-10-05",
      "hijri": "1423-07-28"
    },
    "in_liquidation_process": false,
    "has_e_commerce": true,
    "headquarters": {
      "city_id": 1,
      "city_name": {
        "ar": "الرياض",
        "en": null
      }
    },
    "license": {
      "is_license_based": true,
      "issuer_national_number": "76537",
      "issuer_name": {
        "ar": "وزارة التجارة",
        "en": null
      }
    },
    "partners": {
      "nationality_id": 1,
      "nationality": {
        "ar": "السعودية",
        "en": null
      }
    },
    "entity_type": {
      "id": 1,
      "name": {
        "ar": "شركة",
        "en": null
      },
      "form_id": 1,
      "form_name": {
        "ar": "ذات مسؤولية محدودة",
        "en": null
      },
      "characters": [
        {
          "id": 3,
          "ar": "ذات مسؤولية محدودة",
          "en": null
        }
      ]
    },
    "status": {
      "id": 1,
      "ar": "فعال",
      "en": null
    },
    "confirmation_date": {
      "gregorian": "2003-10-05",
      "hijri": "1424-07-28"
    },
    "reactivation_date": null,
    "suspension_date": null,
    "deletion_date": null,
    "contact_info": {
      "phone_number": "011256398",
      "mobile_number": "050111101",
      "email": "TestEmail@mail.com",
      "website_url": "www.example.com"
    },
    "e_commerce": {
      "e_store": [
        {
          "authentication_platform_url": "www.example.com",
          "store_url": "www.example.com",
          "store_activities": [
            {
              "id": "476201",
              "ar": "صناعة زبدة المكسرات",
              "en": null
            }
          ]
        }
      ]
    },
    "capital_information": {
      "currency_id": 1,
      "currency": {
        "ar": "ريال سعودي",
        "en": null
      },
      "contribution_capital": {
        "type_id": 1,
        "type": {
          "ar": "نقدي",
          "en": null
        },
        "cash_capital": 75000,
        "in_kind_capital": 0,
        "contribution_value": 100,
        "total_cash_contribution": 750,
        "total_in_kind_contribution": 0
      },
      "stock_capital": {
        "type": null,
        "capital": null,
        "announced_capital": null,
        "paid_capital": null,
        "cash_capital": null,
        "in_kind_capital": null,
        "stocks": null
      }
    },
    "fiscal_year": {
      "is_first": true,
      "calendar_type_id": 2,
      "calendar_type": {
        "ar": "هجري",
        "en": null
      },
      "end_month": 12,
      "end_day": 30,
      "end_year": null
    },
    "parties": [
      {
        "name": {
          "ar": "وقف",
          "en": null
        },
        "type_id": 11,
        "type": {
          "ar": "وقف",
          "en": null
        },
        "identity": {
          "id": "7111111111",
          "type_id": 1,
          "type": {
            "ar": "رقم صك الوقف",
            "en": null
          }
        },
        "partnership": [
          {
            "id": 2,
            "ar": "مؤسس",
            "en": null
          }
        ],
        "partner_share": {
          "cash_contribution_count": 0,
          "in_kind_contribution_count": 0,
          "total_contribution_count": 0
        },
        "nationality": null,
        "license_number": null,
        "commercial_registration_number": null,
        "partner_profit_loss_distribution": {
          "profit_distribution": 0,
          "loss_distribution": 0
        },
        "guardian": null
      }
    ],
    "management": {
      "structure_id": 1,
      "structure_name": {
        "ar": "مديران أو أكثر",
        "en": null
      },
      "dismissal_method": {
        "ar": "بقرار من مجلس الإدارة",
        "en": null
      },
      "managers": [
        {
          "name": {
            "ar": "محمد أحمد علي",
            "en": null
          },
          "type_id": 1,
          "type": {
            "ar": "مقيم",
            "en": null
          },
          "is_licensed": true,
          "identity": {
            "id": "2123456789",
            "type_id": 1,
            "type": {
              "ar": "هوية مقيم",
              "en": null
            }
          },
          "nationality": {
            "id": 113,
            "type": {
              "ar": "سعودي",
              "en": null
            }
          },
          "positions": [
            {
              "id": 2,
              "ar": "مدير تنفيذي",
              "en": null
            }
          ]
        }
      ],
      "management_board": {
        "meeting_quorum_id": 1,
        "meeting_quorum_name": {
          "ar": "جميع المديرين",
          "en": null
        },
        "can_delegate_attendance": true,
        "term_years": 3,
        "way_of_work": {
          "ar": "اجتماعات شهرية",
          "en": null
        },
        "meeting_place": {
          "ar": "مقر الشركة",
          "en": null
        },
        "additional_text": null,
        "positions": [
          {
            "id": 1,
            "name": {
              "ar": "رئيس",
              "en": null
            }
          }
        ]
      },
      "directors_board": {
        "member_count": 5,
        "term_years": 3,
        "value": 10000,
        "value_max": 50000,
        "way_of_work": {
          "ar": "اجتماعات ربع سنوية",
          "en": null
        },
        "meeting_place": {
          "ar": "مقر الشركة",
          "en": null
        },
        "meeting_quorum": 3,
        "meeting_legal_quorum": 4,
        "can_delegate_attendance": true,
        "board_call_mechanism": {
          "ar": "إشعار كتابي",
          "en": null
        },
        "membership_expiry_terms": {
          "ar": "نهاية الفترة أو الاستقالة",
          "en": null
        },
        "additional_text": null,
        "rewards": [
          {
            "id": "1",
            "name": {
              "ar": "مكافأة سنوية",
              "en": null
            }
          }
        ],
        "positions": [
          {
            "id": 1,
            "name": {
              "ar": "رئيس مجلس الإدارة",
              "en": null
            }
          }
        ]
      }
    },
    "liquidators": null,
    "activities": [
      {
        "id": "9820",
        "ar": "صناعة عبايات الرجال",
        "en": null
      },
      {
        "id": "162910",
        "ar": "أنشطة أخرى خاصة بصناعة نشر الأخشاب",
        "en": null
      },
      {
        "id": "477340",
        "ar": "صناعة السلالم والدرابزينات",
        "en": null
      }
    ],
    "notification_channel": [
      {
        "id": 1,
        "name": {
          "ar": "رسائل نصية",
          "en": null
        }
      }
    ],
    "partner_decision": [
      {
        "id": 4,
        "name": {
          "ar": "تعديل عقد التأسيس",
          "en": null
        },
        "approve_percentage": "75",
        "approve_additional_text": {
          "ar": "يتطلب موافقة مجلس الإدارة",
          "en": null
        }
      }
    ],
    "additional_decision_text": "All major decisions require unanimous consent",
    "set_aside_details": {
      "is_set_aside_enabled": true,
      "profit_allocation": {
        "percentage": 10,
        "purpose": {
          "ar": "صندوق احتياطي للتوسع",
          "en": null
        }
      }
    },
    "articles": [
      {
        "id": 1,
        "text": {
          "ar": "تعمل الشركة وفقاً لنظام التجارة السعودي",
          "en": null
        },
        "part_id": 1,
        "part_name": {
          "ar": "الباب الأول",
          "en": null
        }
      }
    ],
    "additional_articles": [
      {
        "title": {
          "ar": "شرط عدم المنافسة",
          "en": null
        },
        "text": {
          "ar": "لا يجوز للشركاء ممارسة أعمال منافسة",
          "en": null
        },
        "part_id": 2,
        "part_name": {
          "ar": "الباب الثاني",
          "en": null
        }
      }
    ],
    "addresses": null
  }
};

export const CORPORATE_ADDRESS: Record<string, unknown> = {
  "status": "OK",
  "results_id": "0f79abdf-fa89-93a3-8b9c-40a3b6dc2b3a",
  "message": "Data successfully retrieved",
  "timestamp": "2024-10-24T15:37:35.254Z",
  "meta": null,
  "status_detail": null,
  "verifications": {
    "contract_copy_number": null,
    "contract_date": null,
    "commercial_registry": null,
    "company_name": null,
    "name_language": null,
    "commercial_registration_capital": null,
    "days_since_company_established": null,
    "main_commercial_registry": null,
    "issue_date": null,
    "in_liquidation_process": null,
    "has_e_commerce": null,
    "headquarters": null,
    "license": null,
    "partners": null,
    "entity_type": null,
    "status": null,
    "confirmation_date": null,
    "reactivation_date": null,
    "suspension_date": null,
    "deletion_date": null,
    "contact_info": null,
    "e_commerce": null,
    "capital_information": null,
    "fiscal_year": null,
    "parties": null,
    "management": null,
    "liquidators": null,
    "activities": null,
    "notification_channel": null,
    "partner_decision": null,
    "additional_decision_text": null,
    "set_aside_details": null,
    "articles": null,
    "additional_articles": null,
    "addresses": [
      {
        "title": "مطعم ومعجنات السندباد",
        "address": "8411 طريق الملك فهد - حي المروج",
        "address2": "الرياض 12263 - 2743",
        "latitude": "24.75014397",
        "longitude": "46.72224397",
        "building_number": "2455",
        "street": "طريق الملك فهد",
        "district": "حي المروج",
        "district_id": "2422",
        "city": "الرياض",
        "city_id": "3",
        "post_code": "12263",
        "additional_number": "14433",
        "region_name": "الرياض",
        "region_id": "1",
        "is_primary_address": "true",
        "unit_number": "1",
        "restriction": null,
        "pk_address_id": "1226384672743",
        "status": "نشط"
      }
    ]
  }
};

export const CORPORATE_NOT_FOUND: Record<string, unknown> = {
  "status": "FAILED",
  "results_id": "b7c3f1e2-9a4d-4c1b-8f6e-2d5a7c9e1b34",
  "message": "No Match Found",
  "timestamp": "2024-10-24T15:37:35.254Z",
  "meta": null,
  "status_detail": {
    "granular_status_code": "DATA_NOT_FOUND",
    "status_additional_info": "No Match Found"
  }
};

export const CORPORATE_MANAGER: Record<string, unknown> = {
  "status": "OK",
  "results_id": "0f79abdf-fa89-93a3-8b9c-40a3b6dc2b3a",
  "message": "Data successfully retrieved",
  "timestamp": "2024-10-24T15:37:35.254Z",
  "meta": null,
  "status_detail": null,
  "verifications": [
    {
      "name": {
        "ar": "السيد عبدالعزيز احمد خالد الثنيان",
        "en": null
      },
      "type_id": 1,
      "type": {
        "ar": "سعودي",
        "en": null
      },
      "is_licensed": true,
      "identity": {
        "id": "1234567890",
        "type_id": 1,
        "type": {
          "ar": "هوية وطنية",
          "en": null
        }
      },
      "nationality": {
        "id": 113,
        "type": {
          "ar": "سعودي",
          "en": null
        }
      },
      "positions": [
        {
          "id": 2,
          "ar": "مدير تنفيذي",
          "en": null
        }
      ],
      "permissions": [
        {
          "id": 5,
          "name": {
            "ar": "إصدار توكيل",
            "en": null
          },
          "can_issue_poa": true,
          "can_delegate": false,
          "special_condition_text": {
            "ar": "يتطلب موافقة مجلس الإدارة",
            "en": null
          },
          "exercise_method_id": 1,
          "exercise_method_description": {
            "ar": "منفرداً",
            "en": null
          }
        },
        {
          "id": 8,
          "name": {
            "ar": "توقيع العقود",
            "en": null
          },
          "can_issue_poa": false,
          "can_delegate": true,
          "special_condition_text": {
            "ar": null,
            "en": null
          },
          "exercise_method_id": 2,
          "exercise_method_description": {
            "ar": "مجتمعين",
            "en": null
          }
        }
      ]
    }
  ]
};

export const FREELANCER_ACTIVE: Record<string, unknown> = {
  "status": "OK",
  "results_id": "e894ede4-dd81-41fb-b52d-fb4fec16c16c",
  "message": "Data successfully retrieved",
  "timestamp": "2025-05-19T12:09:54.672818827Z",
  "meta": null,
  "status_detail": null,
  "verifications": {
    "certificate_ownership_verified": "VERIFIED",
    "national_id": "1107454009",
    "name": {
      "ar": "عادل عيد نفل الحارثي",
      "en": "adel"
    },
    "national_id_expiry_date": "1450-07-01",
    "certificate": [
      {
        "expiry_date": "2025-08-21",
        "number": "FL-013988291",
        "status": "ACTIVE",
        "revoked_at": null,
        "issue_date": "2024-08-21",
        "speciality": {
          "code": "AS090",
          "name": {
            "en": "Sales Promotion and Management",
            "ar": "ادارة وتنشيط المبيعات"
          },
          "category": {
            "name": {
              "en": "Sales & Marketing",
              "ar": "المبيعات والتسويق"
            },
            "code": "C106"
          }
        },
        "canceled_at": null
      }
    ],
    "gender": "MALE"
  }
};

export const FREELANCER_NOT_VERIFIED: Record<string, unknown> = {
  "status": "OK",
  "results_id": "e894ede4-dd81-41fb-b52d-fb4fec16c16c",
  "message": "National ID and certificate number doesn't match",
  "timestamp": "2025-05-19T12:09:54.672818827Z",
  "meta": null,
  "status_detail": null,
  "verifications": {
    "certificate_ownership_verified": "NOT_VERIFIED",
    "national_id": null,
    "name": null,
    "national_id_expiry_date": null,
    "certificate": [],
    "gender": null
  }
};

export const FREELANCER_CANCELED: Record<string, unknown> = {
  "status": "OK",
  "results_id": "e894ede4-dd81-41fb-b52d-fb4fec16c16c",
  "message": "Data successfully retrieved",
  "timestamp": "2025-05-19T12:09:54.672818827Z",
  "meta": null,
  "status_detail": null,
  "verifications": {
    "certificate_ownership_verified": "VERIFIED",
    "national_id": "1107454009",
    "name": {
      "ar": "عادل عيد نفل الحارثي",
      "en": "adel"
    },
    "national_id_expiry_date": "1450-07-01",
    "certificate": [
      {
        "expiry_date": "2025-08-21",
        "number": "FL-013988291",
        "status": "CANCELED",
        "revoked_at": null,
        "issue_date": "2024-08-21",
        "speciality": {
          "code": "AS090",
          "name": {
            "en": "Sales Promotion and Management",
            "ar": "ادارة وتنشيط المبيعات"
          },
          "category": {
            "name": {
              "en": "Sales & Marketing",
              "ar": "المبيعات والتسويق"
            },
            "code": "C106"
          }
        },
        "canceled_at": "2025-05-26T00:00:00Z"
      }
    ],
    "gender": "MALE"
  }
};

export const IBAN_MATCH: Record<string, unknown> = {
  "status": "OK",
  "results_id": "e894ede4-dd81-41fb-b52d-fb4fec16c16c",
  "message": "Data successfully retrieved",
  "timestamp": "2025-05-19T12:09:54.672818827Z",
  "meta": null,
  "status_detail": null,
  "verifications": {
    "iban_ownership_verified": true,
    "swift_code": "ALBISARI",
    "bank_name": {
      "en": "AlBilad Bank",
      "ar": "بنك البلاد"
    },
    "bank_code": "١٥",
    "account_status": "ACTIVE",
    "account_holder_name": "NA****AL**** IN****RM****IO**** SY****E****",
    "verification_method": "SARIE"
  }
};

export const IBAN_NO_MATCH: Record<string, unknown> = {
  "status": "OK",
  "results_id": "e894ede4-dd81-41fb-b52d-fb4fec16c16c",
  "message": "Data successfully retrieved",
  "timestamp": "2025-05-19T12:09:54.672818827Z",
  "meta": null,
  "status_detail": null,
  "verifications": {
    "iban_ownership_verified": false,
    "swift_code": "ALBISARI",
    "bank_name": {
      "en": "AlBilad Bank",
      "ar": "بنك البلاد"
    },
    "bank_code": "١٥",
    "account_status": "ACTIVE",
    "account_holder_name": "NA****AL**** IN****RM****IO**** SY****E****",
    "verification_method": "SARIE"
  }
};

export const IBAN_INACTIVE: Record<string, unknown> = {
  "status": "OK",
  "results_id": "e894ede4-dd81-41fb-b52d-fb4fec16c16c",
  "message": "Data successfully retrieved",
  "timestamp": "2024-02-09T15:57:29.144075150Z",
  "verifications": {
    "iban_ownership_verified": false,
    "swift_code": "ALBISARI",
    "bank_name": {
      "en": "AlBilad Bank",
      "ar": "بنك البلاد"
    },
    "bank_code": "15",
    "verification_method": "SARIE",
    "account_status": "BLOCKED"
  }
};

export const IBAN_UNSUPPORTED_BANK: Record<string, unknown> = {
  "status": "FAILED",
  "results_id": "f894ede4-dd81-41fb-b52d-fb4fec16c16c",
  "message": "Iban Verification by Saudi Payments Failed",
  "timestamp": "2024-04-30T07:54:25.224020260Z",
  "status_detail": {
    "granular_status_code": "UNSUPPORTED_BY_BANK",
    "status_additional_info": "This endpoint is currently not supported for this bank."
  }
};

export const IBAN_NAME_PARTIAL: Record<string, unknown> = {
  "status": "OK",
  "results_id": "e894ede4-dd81-41fb-b52d-fb4fec16c16c",
  "message": "Data successfully retrieved",
  "timestamp": "2025-05-19T12:09:54.672818827Z",
  "meta": null,
  "status_detail": null,
  "verifications": {
    "iban_ownership_verified": false,
    "matching": {
      "type": "PARTIAL",
      "score": 0.7
    },
    "swift_code": "ALBISARI",
    "bank_name": {
      "en": "AlBilad Bank",
      "ar": "بنك البلاد"
    },
    "bank_code": "24",
    "account_status": "ACTIVE",
    "account_holder_name": "NA****AL**** IN****RM****IO**** SY****E****",
    "verification_method": "SARIE_AND_CONFIRMATION_OF_PAYEE_SERVICE"
  }
};

export const BENEFICIARY_ACTIVE: Record<string, unknown> = {
  "status": "OK",
  "results_id": "d2d95011-f834-4979-83eb-9c35b95f093c",
  "message": "Data successfully retrieved",
  "timestamp": "2025-07-25T11:01:04.709087696Z",
  "meta": null,
  "status_detail": null,
  "verifications": {
    "beneficiary_name": "JON DOE",
    "account_status": "ACTIVE"
  }
};

export const BENEFICIARY_BLOCKED: Record<string, unknown> = {
  "status": "OK",
  "results_id": "e894ede4-dd81-41fb-b52d-fb4fec16c16c",
  "message": "Data successfully retrieved",
  "timestamp": "2025-05-19T12:09:54.672818827Z",
  "meta": null,
  "status_detail": null,
  "verifications": {
    "beneficiary_name": "JON DOE",
    "account_status": "BLOCKED"
  }
};
