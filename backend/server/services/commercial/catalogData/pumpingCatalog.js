// Literal data extracted programmatically (openpyxl) from Solar_Pumping3.xlsx.
// Pump catalog: 513 rows from the Design sheet's own reshaped lookup table
// (Design!J3:Q515 - one row per model/head-band combination, sourced from the 'Pump Price List'
// sheet). Motor catalog: 24 rows from 'Motor Price List'!A4:F27.
// Extracted mechanically rather than hand-transcribed to avoid copy errors across 500+ rows.
'use strict';

const PUMPS = [
 {
  "model": "SP 15/06",
  "casing": "6\"",
  "hp": 5.5,
  "outlet": "2.5\"",
  "flowM3h": 12,
  "headM": 57,
  "price": 23585
 },
 {
  "model": "SP 15/06",
  "casing": "6\"",
  "hp": 5.5,
  "outlet": "2.5\"",
  "flowM3h": 15,
  "headM": 51,
  "price": 23585
 },
 {
  "model": "SP 15/06",
  "casing": "6\"",
  "hp": 5.5,
  "outlet": "2.5\"",
  "flowM3h": 21,
  "headM": 34,
  "price": 23585
 },
 {
  "model": "SP 15/07",
  "casing": "6-4\"",
  "hp": 5.5,
  "outlet": "2.5\"",
  "flowM3h": 12,
  "headM": 67,
  "price": 25733
 },
 {
  "model": "SP 15/07",
  "casing": "6-4\"",
  "hp": 5.5,
  "outlet": "2.5\"",
  "flowM3h": 18,
  "headM": 51,
  "price": 25733
 },
 {
  "model": "SP 15/07",
  "casing": "6-4\"",
  "hp": 5.5,
  "outlet": "2.5\"",
  "flowM3h": 21,
  "headM": 40,
  "price": 25733
 },
 {
  "model": "SP 15/10",
  "casing": "6\"",
  "hp": 7.5,
  "outlet": "2.5\"",
  "flowM3h": 15,
  "headM": 85,
  "price": 32639
 },
 {
  "model": "SP 15/10",
  "casing": "6\"",
  "hp": 7.5,
  "outlet": "2.5\"",
  "flowM3h": 18,
  "headM": 73,
  "price": 32639
 },
 {
  "model": "SP 15/12",
  "casing": "6\"",
  "hp": 10,
  "outlet": "2.5\"",
  "flowM3h": 18,
  "headM": 87,
  "price": 37095
 },
 {
  "model": "SP 15/12",
  "casing": "6\"",
  "hp": 10,
  "outlet": "2.5\"",
  "flowM3h": 21,
  "headM": 68,
  "price": 37095
 },
 {
  "model": "SP 15/20",
  "casing": "6\"",
  "hp": 15,
  "outlet": "2.5\"",
  "flowM3h": 15,
  "headM": 171,
  "price": 55253
 },
 {
  "model": "SP 15/20",
  "casing": "6\"",
  "hp": 15,
  "outlet": "2.5\"",
  "flowM3h": 18,
  "headM": 146,
  "price": 55253
 },
 {
  "model": "SP 15/20",
  "casing": "6\"",
  "hp": 15,
  "outlet": "2.5\"",
  "flowM3h": 21,
  "headM": 113,
  "price": 55253
 },
 {
  "model": "SP 15/25",
  "casing": "6\"",
  "hp": 20,
  "outlet": "2.5\"",
  "flowM3h": 15,
  "headM": 214,
  "price": 66716
 },
 {
  "model": "SP 15/25",
  "casing": "6\"",
  "hp": 20,
  "outlet": "2.5\"",
  "flowM3h": 21,
  "headM": 142,
  "price": 66716
 },
 {
  "model": "SP 30/04",
  "casing": "6\"",
  "hp": 6,
  "outlet": "3\"",
  "flowM3h": 24,
  "headM": 35,
  "price": 19412
 },
 {
  "model": "SP 30/04",
  "casing": "6\"",
  "hp": 6,
  "outlet": "3\"",
  "flowM3h": 27,
  "headM": 33,
  "price": 19412
 },
 {
  "model": "SP 30/04",
  "casing": "6\"",
  "hp": 6,
  "outlet": "3\"",
  "flowM3h": 33,
  "headM": 26,
  "price": 19412
 },
 {
  "model": "SP 30/05",
  "casing": "6\"",
  "hp": 7.5,
  "outlet": "3\"",
  "flowM3h": 24,
  "headM": 44,
  "price": 21496
 },
 {
  "model": "SP 30/05",
  "casing": "6\"",
  "hp": 7.5,
  "outlet": "3\"",
  "flowM3h": 33,
  "headM": 32,
  "price": 21496
 },
 {
  "model": "SP 30/06",
  "casing": "6\"",
  "hp": 7.5,
  "outlet": "3\"",
  "flowM3h": 24,
  "headM": 52,
  "price": 24239
 },
 {
  "model": "SP 30/06",
  "casing": "6\"",
  "hp": 7.5,
  "outlet": "3\"",
  "flowM3h": 27,
  "headM": 49,
  "price": 24239
 },
 {
  "model": "SP 30/06",
  "casing": "6\"",
  "hp": 7.5,
  "outlet": "3\"",
  "flowM3h": 30,
  "headM": 44,
  "price": 24239
 },
 {
  "model": "SP 30/06",
  "casing": "6\"",
  "hp": 7.5,
  "outlet": "3\"",
  "flowM3h": 33,
  "headM": 39,
  "price": 24239
 },
 {
  "model": "SP 30/08",
  "casing": "6\"",
  "hp": 10,
  "outlet": "3\"",
  "flowM3h": 27,
  "headM": 65,
  "price": 29676
 },
 {
  "model": "SP 30/08",
  "casing": "6\"",
  "hp": 10,
  "outlet": "3\"",
  "flowM3h": 30,
  "headM": 59,
  "price": 29676
 },
 {
  "model": "SP 30/08",
  "casing": "6\"",
  "hp": 10,
  "outlet": "3\"",
  "flowM3h": 33,
  "headM": 52,
  "price": 29676
 },
 {
  "model": "SP 30/12",
  "casing": "6\"",
  "hp": 15,
  "outlet": "3\"",
  "flowM3h": 24,
  "headM": 105,
  "price": 40648
 },
 {
  "model": "SP 30/12",
  "casing": "6\"",
  "hp": 15,
  "outlet": "3\"",
  "flowM3h": 27,
  "headM": 98,
  "price": 40648
 },
 {
  "model": "SP 30/13",
  "casing": "6\"",
  "hp": 15,
  "outlet": "3\"",
  "flowM3h": 27,
  "headM": 106,
  "price": 42992
 },
 {
  "model": "SP 30/13",
  "casing": "6\"",
  "hp": 15,
  "outlet": "3\"",
  "flowM3h": 30,
  "headM": 96,
  "price": 42992
 },
 {
  "model": "SP 30/13",
  "casing": "6\"",
  "hp": 15,
  "outlet": "3\"",
  "flowM3h": 33,
  "headM": 84,
  "price": 42992
 },
 {
  "model": "SP 30/16",
  "casing": "6\"",
  "hp": 20,
  "outlet": "3\"",
  "flowM3h": 24,
  "headM": 140,
  "price": 50873
 },
 {
  "model": "SP 30/16",
  "casing": "6\"",
  "hp": 20,
  "outlet": "3\"",
  "flowM3h": 27,
  "headM": 130,
  "price": 50873
 },
 {
  "model": "SP 30/16",
  "casing": "6\"",
  "hp": 20,
  "outlet": "3\"",
  "flowM3h": 30,
  "headM": 118,
  "price": 50873
 },
 {
  "model": "SP 30/16",
  "casing": "6\"",
  "hp": 20,
  "outlet": "3\"",
  "flowM3h": 33,
  "headM": 104,
  "price": 50873
 },
 {
  "model": "SP 30/20",
  "casing": "6\"",
  "hp": 25,
  "outlet": "3\"",
  "flowM3h": 24,
  "headM": 175,
  "price": 61296
 },
 {
  "model": "SP 30/20",
  "casing": "6\"",
  "hp": 25,
  "outlet": "3\"",
  "flowM3h": 27,
  "headM": 163,
  "price": 61296
 },
 {
  "model": "SP 30/20",
  "casing": "6\"",
  "hp": 25,
  "outlet": "3\"",
  "flowM3h": 30,
  "headM": 148,
  "price": 61296
 },
 {
  "model": "SP 30/25",
  "casing": "6\"",
  "hp": 30,
  "outlet": "3\"",
  "flowM3h": 24,
  "headM": 219,
  "price": 75660
 },
 {
  "model": "SP 30/25",
  "casing": "6\"",
  "hp": 30,
  "outlet": "3\"",
  "flowM3h": 27,
  "headM": 204,
  "price": 75660
 },
 {
  "model": "SP 30/25",
  "casing": "6\"",
  "hp": 30,
  "outlet": "3\"",
  "flowM3h": 30,
  "headM": 185,
  "price": 75660
 },
 {
  "model": "SP 30/25",
  "casing": "6\"",
  "hp": 30,
  "outlet": "3\"",
  "flowM3h": 33,
  "headM": 162,
  "price": 75660
 },
 {
  "model": "SP 30/35",
  "casing": "6\"",
  "hp": 40,
  "outlet": "3\"",
  "flowM3h": 24,
  "headM": 306,
  "price": 97886
 },
 {
  "model": "SP 30/35",
  "casing": "6\"",
  "hp": 40,
  "outlet": "3\"",
  "flowM3h": 27,
  "headM": 285,
  "price": 97886
 },
 {
  "model": "SP 30/35",
  "casing": "6\"",
  "hp": 40,
  "outlet": "3\"",
  "flowM3h": 30,
  "headM": 259,
  "price": 97886
 },
 {
  "model": "SP 42/03",
  "casing": "6\"",
  "hp": 7.5,
  "outlet": "3\"",
  "flowM3h": 42,
  "headM": 28,
  "price": 19900
 },
 {
  "model": "SP 42/03",
  "casing": "6\"",
  "hp": 7.5,
  "outlet": "3\"",
  "flowM3h": 48,
  "headM": 24,
  "price": 19900
 },
 {
  "model": "SP 42/03",
  "casing": "6\"",
  "hp": 7.5,
  "outlet": "3\"",
  "flowM3h": 54,
  "headM": 20,
  "price": 19900
 },
 {
  "model": "SP 42/05",
  "casing": "6\"",
  "hp": 10,
  "outlet": "3\"",
  "flowM3h": 36,
  "headM": 52,
  "price": 25386
 },
 {
  "model": "SP 42/05",
  "casing": "6\"",
  "hp": 10,
  "outlet": "3\"",
  "flowM3h": 42,
  "headM": 47,
  "price": 25386
 },
 {
  "model": "SP 42/05",
  "casing": "6\"",
  "hp": 10,
  "outlet": "3\"",
  "flowM3h": 48,
  "headM": 41,
  "price": 25386
 },
 {
  "model": "SP 42/05",
  "casing": "6\"",
  "hp": 10,
  "outlet": "3\"",
  "flowM3h": 54,
  "headM": 33,
  "price": 25386
 },
 {
  "model": "SP 42/07",
  "casing": "6\"",
  "hp": 15,
  "outlet": "3\"",
  "flowM3h": 36,
  "headM": 73,
  "price": 32419
 },
 {
  "model": "SP 42/07",
  "casing": "6\"",
  "hp": 15,
  "outlet": "3\"",
  "flowM3h": 42,
  "headM": 65,
  "price": 32419
 },
 {
  "model": "SP 42/07",
  "casing": "6\"",
  "hp": 15,
  "outlet": "3\"",
  "flowM3h": 48,
  "headM": 57,
  "price": 32419
 },
 {
  "model": "SP 42/07",
  "casing": "6\"",
  "hp": 15,
  "outlet": "3\"",
  "flowM3h": 54,
  "headM": 47,
  "price": 32419
 },
 {
  "model": "SP 42/09",
  "casing": "6\"",
  "hp": 20,
  "outlet": "3\"",
  "flowM3h": 36,
  "headM": 93,
  "price": 39302
 },
 {
  "model": "SP 42/09",
  "casing": "6\"",
  "hp": 20,
  "outlet": "3\"",
  "flowM3h": 42,
  "headM": 84,
  "price": 39302
 },
 {
  "model": "SP 42/09",
  "casing": "6\"",
  "hp": 20,
  "outlet": "3\"",
  "flowM3h": 48,
  "headM": 73,
  "price": 39302
 },
 {
  "model": "SP 42/09",
  "casing": "6\"",
  "hp": 20,
  "outlet": "3\"",
  "flowM3h": 54,
  "headM": 60,
  "price": 39302
 },
 {
  "model": "SP 42/10",
  "casing": "6\"",
  "hp": 20,
  "outlet": "3\"",
  "flowM3h": 36,
  "headM": 104,
  "price": 42693
 },
 {
  "model": "SP 42/10",
  "casing": "6\"",
  "hp": 20,
  "outlet": "3\"",
  "flowM3h": 42,
  "headM": 93,
  "price": 42693
 },
 {
  "model": "SP 42/10",
  "casing": "6\"",
  "hp": 20,
  "outlet": "3\"",
  "flowM3h": 48,
  "headM": 81,
  "price": 42693
 },
 {
  "model": "SP 42/10",
  "casing": "6\"",
  "hp": 20,
  "outlet": "3\"",
  "flowM3h": 54,
  "headM": 67,
  "price": 42693
 },
 {
  "model": "SP 42/12",
  "casing": "6\"",
  "hp": 25,
  "outlet": "3\"",
  "flowM3h": 36,
  "headM": 124,
  "price": 49376
 },
 {
  "model": "SP 42/12",
  "casing": "6\"",
  "hp": 25,
  "outlet": "3\"",
  "flowM3h": 42,
  "headM": 112,
  "price": 49376
 },
 {
  "model": "SP 42/12",
  "casing": "6\"",
  "hp": 25,
  "outlet": "3\"",
  "flowM3h": 48,
  "headM": 98,
  "price": 49376
 },
 {
  "model": "SP 42/12",
  "casing": "6\"",
  "hp": 25,
  "outlet": "3\"",
  "flowM3h": 54,
  "headM": 80,
  "price": 49376
 },
 {
  "model": "SP 42/14",
  "casing": "6\"",
  "hp": 30,
  "outlet": "3\"",
  "flowM3h": 36,
  "headM": 145,
  "price": 56259
 },
 {
  "model": "SP 42/14",
  "casing": "6\"",
  "hp": 30,
  "outlet": "3\"",
  "flowM3h": 42,
  "headM": 131,
  "price": 56259
 },
 {
  "model": "SP 42/14",
  "casing": "6\"",
  "hp": 30,
  "outlet": "3\"",
  "flowM3h": 48,
  "headM": 114,
  "price": 56259
 },
 {
  "model": "SP 42/14",
  "casing": "6\"",
  "hp": 30,
  "outlet": "3\"",
  "flowM3h": 54,
  "headM": 94,
  "price": 56259
 },
 {
  "model": "SP 42/16",
  "casing": "6\"",
  "hp": 35,
  "outlet": "3\"",
  "flowM3h": 36,
  "headM": 166,
  "price": 62892
 },
 {
  "model": "SP 42/16",
  "casing": "6\"",
  "hp": 35,
  "outlet": "3\"",
  "flowM3h": 42,
  "headM": 149,
  "price": 62892
 },
 {
  "model": "SP 42/16",
  "casing": "6\"",
  "hp": 35,
  "outlet": "3\"",
  "flowM3h": 48,
  "headM": 130,
  "price": 62892
 },
 {
  "model": "SP 42/16",
  "casing": "6\"",
  "hp": 35,
  "outlet": "3\"",
  "flowM3h": 54,
  "headM": 107,
  "price": 62892
 },
 {
  "model": "SP 42/19",
  "casing": "6\"",
  "hp": 40,
  "outlet": "3\"",
  "flowM3h": 36,
  "headM": 197,
  "price": 73815
 },
 {
  "model": "SP 42/19",
  "casing": "6\"",
  "hp": 40,
  "outlet": "3\"",
  "flowM3h": 42,
  "headM": 177,
  "price": 73815
 },
 {
  "model": "SP 42/19",
  "casing": "6\"",
  "hp": 40,
  "outlet": "3\"",
  "flowM3h": 48,
  "headM": 155,
  "price": 73815
 },
 {
  "model": "SP 42/19",
  "casing": "6\"",
  "hp": 40,
  "outlet": "3\"",
  "flowM3h": 54,
  "headM": 127,
  "price": 73815
 },
 {
  "model": "SP 42/24",
  "casing": "7\"",
  "hp": 50,
  "outlet": "3\"",
  "flowM3h": 36,
  "headM": 249,
  "price": 92418
 },
 {
  "model": "SP 42/24",
  "casing": "7\"",
  "hp": 50,
  "outlet": "3\"",
  "flowM3h": 42,
  "headM": 224,
  "price": 92418
 },
 {
  "model": "SP 42/24",
  "casing": "7\"",
  "hp": 50,
  "outlet": "3\"",
  "flowM3h": 48,
  "headM": 195,
  "price": 92418
 },
 {
  "model": "SP 42/24",
  "casing": "7\"",
  "hp": 50,
  "outlet": "3\"",
  "flowM3h": 54,
  "headM": 161,
  "price": 92418
 },
 {
  "model": "SP 60/02",
  "casing": "6\"",
  "hp": 6,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 19,
  "price": 16658
 },
 {
  "model": "SP 60/02",
  "casing": "6\"",
  "hp": 6,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 17,
  "price": 16658
 },
 {
  "model": "SP 60/02",
  "casing": "6\"",
  "hp": 6,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 15,
  "price": 16658
 },
 {
  "model": "SP 60/02",
  "casing": "6\"",
  "hp": 6,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 13,
  "price": 16658
 },
 {
  "model": "SP 60/03",
  "casing": "6\"",
  "hp": 7.5,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 28,
  "price": 19651
 },
 {
  "model": "SP 60/03",
  "casing": "6\"",
  "hp": 7.5,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 26,
  "price": 19651
 },
 {
  "model": "SP 60/03",
  "casing": "6\"",
  "hp": 7.5,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 23,
  "price": 19651
 },
 {
  "model": "SP 60/03",
  "casing": "6\"",
  "hp": 7.5,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 20,
  "price": 19651
 },
 {
  "model": "SP 60/04",
  "casing": "6\"",
  "hp": 10,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 37,
  "price": 22643
 },
 {
  "model": "SP 60/04",
  "casing": "6\"",
  "hp": 10,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 34,
  "price": 22643
 },
 {
  "model": "SP 60/04",
  "casing": "6\"",
  "hp": 10,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 31,
  "price": 22643
 },
 {
  "model": "SP 60/04",
  "casing": "6\"",
  "hp": 10,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 27,
  "price": 22643
 },
 {
  "model": "SP 60/05",
  "casing": "6\"",
  "hp": 12.5,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 47,
  "price": 27232
 },
 {
  "model": "SP 60/05",
  "casing": "6\"",
  "hp": 12.5,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 43,
  "price": 27232
 },
 {
  "model": "SP 60/05",
  "casing": "6\"",
  "hp": 12.5,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 38,
  "price": 27232
 },
 {
  "model": "SP 60/05",
  "casing": "6\"",
  "hp": 12.5,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 34,
  "price": 27232
 },
 {
  "model": "SP 60/06",
  "casing": "6\"",
  "hp": 15,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 56,
  "price": 29925
 },
 {
  "model": "SP 60/06",
  "casing": "6\"",
  "hp": 15,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 51,
  "price": 29925
 },
 {
  "model": "SP 60/06",
  "casing": "6\"",
  "hp": 15,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 46,
  "price": 29925
 },
 {
  "model": "SP 60/06",
  "casing": "6\"",
  "hp": 15,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 40,
  "price": 29925
 },
 {
  "model": "SP 60/08",
  "casing": "6\"",
  "hp": 20,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 75,
  "price": 37007
 },
 {
  "model": "SP 60/08",
  "casing": "6\"",
  "hp": 20,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 68,
  "price": 37007
 },
 {
  "model": "SP 60/08",
  "casing": "6\"",
  "hp": 20,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 61,
  "price": 37007
 },
 {
  "model": "SP 60/08",
  "casing": "6\"",
  "hp": 20,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 54,
  "price": 37007
 },
 {
  "model": "SP 60/09",
  "casing": "6\"",
  "hp": 25,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 84,
  "price": 41197
 },
 {
  "model": "SP 60/09",
  "casing": "6\"",
  "hp": 25,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 77,
  "price": 41197
 },
 {
  "model": "SP 60/09",
  "casing": "6\"",
  "hp": 25,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 69,
  "price": 41197
 },
 {
  "model": "SP 60/09",
  "casing": "6\"",
  "hp": 25,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 60,
  "price": 41197
 },
 {
  "model": "SP 60/10",
  "casing": "6\"",
  "hp": 25,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 94,
  "price": 45336
 },
 {
  "model": "SP 60/10",
  "casing": "6\"",
  "hp": 25,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 85,
  "price": 45336
 },
 {
  "model": "SP 60/10",
  "casing": "6\"",
  "hp": 25,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 77,
  "price": 45336
 },
 {
  "model": "SP 60/10",
  "casing": "6\"",
  "hp": 25,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 67,
  "price": 45336
 },
 {
  "model": "SP 60/11",
  "casing": "6\"",
  "hp": 30,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 103,
  "price": 49476
 },
 {
  "model": "SP 60/11",
  "casing": "6\"",
  "hp": 30,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 94,
  "price": 49476
 },
 {
  "model": "SP 60/11",
  "casing": "6\"",
  "hp": 30,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 84,
  "price": 49476
 },
 {
  "model": "SP 60/11",
  "casing": "6\"",
  "hp": 30,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 74,
  "price": 49476
 },
 {
  "model": "SP 60/12",
  "casing": "6\"",
  "hp": 30,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 112,
  "price": 53516
 },
 {
  "model": "SP 60/12",
  "casing": "6\"",
  "hp": 30,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 102,
  "price": 53516
 },
 {
  "model": "SP 60/12",
  "casing": "6\"",
  "hp": 30,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 92,
  "price": 53516
 },
 {
  "model": "SP 60/12",
  "casing": "6\"",
  "hp": 30,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 80,
  "price": 53516
 },
 {
  "model": "SP 60/14",
  "casing": "6\"",
  "hp": 35,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 131,
  "price": 60548
 },
 {
  "model": "SP 60/14",
  "casing": "6\"",
  "hp": 35,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 119,
  "price": 60548
 },
 {
  "model": "SP 60/14",
  "casing": "6\"",
  "hp": 35,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 107,
  "price": 60548
 },
 {
  "model": "SP 60/14",
  "casing": "6\"",
  "hp": 35,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 94,
  "price": 60548
 },
 {
  "model": "SP 60/16",
  "casing": "6\"",
  "hp": 40,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 150,
  "price": 67830
 },
 {
  "model": "SP 60/16",
  "casing": "6\"",
  "hp": 40,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 136,
  "price": 67830
 },
 {
  "model": "SP 60/16",
  "casing": "6\"",
  "hp": 40,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 123,
  "price": 67830
 },
 {
  "model": "SP 60/16",
  "casing": "6\"",
  "hp": 40,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 107,
  "price": 67830
 },
 {
  "model": "SP 60/17",
  "casing": "6\"",
  "hp": 40,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 159,
  "price": 71321
 },
 {
  "model": "SP 60/17",
  "casing": "6\"",
  "hp": 40,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 145,
  "price": 71321
 },
 {
  "model": "SP 60/17",
  "casing": "6\"",
  "hp": 40,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 130,
  "price": 71321
 },
 {
  "model": "SP 60/17",
  "casing": "6\"",
  "hp": 40,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 114,
  "price": 71321
 },
 {
  "model": "SP 60/18",
  "casing": "6\"",
  "hp": 50,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 169,
  "price": 75611
 },
 {
  "model": "SP 60/18",
  "casing": "6\"",
  "hp": 50,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 153,
  "price": 75611
 },
 {
  "model": "SP 60/18",
  "casing": "6\"",
  "hp": 50,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 138,
  "price": 75611
 },
 {
  "model": "SP 60/18",
  "casing": "6\"",
  "hp": 50,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 121,
  "price": 75611
 },
 {
  "model": "SP 60/20",
  "casing": "6\"",
  "hp": 50,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 187,
  "price": 84638
 },
 {
  "model": "SP 60/20",
  "casing": "6\"",
  "hp": 50,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 170,
  "price": 84638
 },
 {
  "model": "SP 60/20",
  "casing": "6\"",
  "hp": 50,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 153,
  "price": 84638
 },
 {
  "model": "SP 60/20",
  "casing": "6\"",
  "hp": 50,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 134,
  "price": 84638
 },
 {
  "model": "SP 60/22",
  "casing": "7\"",
  "hp": 60,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 206,
  "price": 93366
 },
 {
  "model": "SP 60/22",
  "casing": "7\"",
  "hp": 60,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 188,
  "price": 93366
 },
 {
  "model": "SP 60/22",
  "casing": "7\"",
  "hp": 60,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 169,
  "price": 93366
 },
 {
  "model": "SP 60/22",
  "casing": "7\"",
  "hp": 60,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 148,
  "price": 93366
 },
 {
  "model": "SP 60/24",
  "casing": "7\"",
  "hp": 60,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 225,
  "price": 102743
 },
 {
  "model": "SP 60/24",
  "casing": "7\"",
  "hp": 60,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 205,
  "price": 102743
 },
 {
  "model": "SP 60/24",
  "casing": "7\"",
  "hp": 60,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 184,
  "price": 102743
 },
 {
  "model": "SP 60/24",
  "casing": "7\"",
  "hp": 60,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 161,
  "price": 102743
 },
 {
  "model": "SP 60/28",
  "casing": "7\"",
  "hp": 70,
  "outlet": "4\"",
  "flowM3h": 48,
  "headM": 262,
  "price": 120797
 },
 {
  "model": "SP 60/28",
  "casing": "7\"",
  "hp": 70,
  "outlet": "4\"",
  "flowM3h": 54,
  "headM": 239,
  "price": 120797
 },
 {
  "model": "SP 60/28",
  "casing": "7\"",
  "hp": 70,
  "outlet": "4\"",
  "flowM3h": 60,
  "headM": 215,
  "price": 120797
 },
 {
  "model": "SP 60/28",
  "casing": "7\"",
  "hp": 70,
  "outlet": "4\"",
  "flowM3h": 66,
  "headM": 188,
  "price": 120797
 },
 {
  "model": "SP 72/02",
  "casing": "6\"",
  "hp": 10,
  "outlet": "5\"",
  "flowM3h": 66,
  "headM": 29,
  "price": 38105
 },
 {
  "model": "SP 72/02",
  "casing": "6\"",
  "hp": 10,
  "outlet": "5\"",
  "flowM3h": 72,
  "headM": 27,
  "price": 38105
 },
 {
  "model": "SP 72/02",
  "casing": "6\"",
  "hp": 10,
  "outlet": "5\"",
  "flowM3h": 78,
  "headM": 25,
  "price": 38105
 },
 {
  "model": "SP 72/02",
  "casing": "6\"",
  "hp": 10,
  "outlet": "5\"",
  "flowM3h": 84,
  "headM": 23,
  "price": 38105
 },
 {
  "model": "SP 72/03",
  "casing": "6\"",
  "hp": 15,
  "outlet": "5\"",
  "flowM3h": 66,
  "headM": 43,
  "price": 43242
 },
 {
  "model": "SP 72/03",
  "casing": "6\"",
  "hp": 15,
  "outlet": "5\"",
  "flowM3h": 72,
  "headM": 40,
  "price": 43242
 },
 {
  "model": "SP 72/03",
  "casing": "6\"",
  "hp": 15,
  "outlet": "5\"",
  "flowM3h": 78,
  "headM": 38,
  "price": 43242
 },
 {
  "model": "SP 72/03",
  "casing": "6\"",
  "hp": 15,
  "outlet": "5\"",
  "flowM3h": 84,
  "headM": 34,
  "price": 43242
 },
 {
  "model": "SP 72/04",
  "casing": "6\"",
  "hp": 20,
  "outlet": "5\"",
  "flowM3h": 66,
  "headM": 57,
  "price": 47232
 },
 {
  "model": "SP 72/04",
  "casing": "6\"",
  "hp": 20,
  "outlet": "5\"",
  "flowM3h": 72,
  "headM": 54,
  "price": 47232
 },
 {
  "model": "SP 72/04",
  "casing": "6\"",
  "hp": 20,
  "outlet": "5\"",
  "flowM3h": 78,
  "headM": 50,
  "price": 47232
 },
 {
  "model": "SP 72/04",
  "casing": "6\"",
  "hp": 20,
  "outlet": "5\"",
  "flowM3h": 84,
  "headM": 46,
  "price": 47232
 },
 {
  "model": "SP 72/05",
  "casing": "6\"",
  "hp": 25,
  "outlet": "5\"",
  "flowM3h": 66,
  "headM": 71,
  "price": 53117
 },
 {
  "model": "SP 72/05",
  "casing": "6\"",
  "hp": 25,
  "outlet": "5\"",
  "flowM3h": 72,
  "headM": 67,
  "price": 53117
 },
 {
  "model": "SP 72/05",
  "casing": "6\"",
  "hp": 25,
  "outlet": "5\"",
  "flowM3h": 78,
  "headM": 63,
  "price": 53117
 },
 {
  "model": "SP 72/05",
  "casing": "6\"",
  "hp": 25,
  "outlet": "5\"",
  "flowM3h": 84,
  "headM": 57,
  "price": 53117
 },
 {
  "model": "SP 72/06",
  "casing": "6\"",
  "hp": 30,
  "outlet": "5\"",
  "flowM3h": 66,
  "headM": 86,
  "price": 58254
 },
 {
  "model": "SP 72/06",
  "casing": "6\"",
  "hp": 30,
  "outlet": "5\"",
  "flowM3h": 72,
  "headM": 81,
  "price": 58254
 },
 {
  "model": "SP 72/06",
  "casing": "6\"",
  "hp": 30,
  "outlet": "5\"",
  "flowM3h": 78,
  "headM": 75,
  "price": 58254
 },
 {
  "model": "SP 72/06",
  "casing": "6\"",
  "hp": 30,
  "outlet": "5\"",
  "flowM3h": 84,
  "headM": 69,
  "price": 58254
 },
 {
  "model": "SP 72/07",
  "casing": "6\"",
  "hp": 35,
  "outlet": "5\"",
  "flowM3h": 66,
  "headM": 100,
  "price": 64389
 },
 {
  "model": "SP 72/07",
  "casing": "6\"",
  "hp": 35,
  "outlet": "5\"",
  "flowM3h": 72,
  "headM": 94,
  "price": 64389
 },
 {
  "model": "SP 72/07",
  "casing": "6\"",
  "hp": 35,
  "outlet": "5\"",
  "flowM3h": 78,
  "headM": 88,
  "price": 64389
 },
 {
  "model": "SP 72/07",
  "casing": "6\"",
  "hp": 35,
  "outlet": "5\"",
  "flowM3h": 84,
  "headM": 80,
  "price": 64389
 },
 {
  "model": "SP 72/08",
  "casing": "6\"",
  "hp": 40,
  "outlet": "5\"",
  "flowM3h": 66,
  "headM": 114,
  "price": 70124
 },
 {
  "model": "SP 72/08",
  "casing": "6\"",
  "hp": 40,
  "outlet": "5\"",
  "flowM3h": 72,
  "headM": 108,
  "price": 70124
 },
 {
  "model": "SP 72/08",
  "casing": "6\"",
  "hp": 40,
  "outlet": "5\"",
  "flowM3h": 78,
  "headM": 101,
  "price": 70124
 },
 {
  "model": "SP 72/08",
  "casing": "6\"",
  "hp": 40,
  "outlet": "5\"",
  "flowM3h": 84,
  "headM": 92,
  "price": 70124
 },
 {
  "model": "SP 72/09",
  "casing": "6\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 66,
  "headM": 128,
  "price": 76359
 },
 {
  "model": "SP 72/09",
  "casing": "6\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 72,
  "headM": 121,
  "price": 76359
 },
 {
  "model": "SP 72/09",
  "casing": "6\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 78,
  "headM": 113,
  "price": 76359
 },
 {
  "model": "SP 72/09",
  "casing": "6\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 84,
  "headM": 103,
  "price": 76359
 },
 {
  "model": "SP 72/10",
  "casing": "8\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 66,
  "headM": 143,
  "price": 84139
 },
 {
  "model": "SP 72/10",
  "casing": "8\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 72,
  "headM": 135,
  "price": 84139
 },
 {
  "model": "SP 72/10",
  "casing": "8\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 78,
  "headM": 126,
  "price": 84139
 },
 {
  "model": "SP 72/10",
  "casing": "8\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 84,
  "headM": 115,
  "price": 84139
 },
 {
  "model": "SP 72/12",
  "casing": "8\"",
  "hp": 60,
  "outlet": "5\"",
  "flowM3h": 66,
  "headM": 171,
  "price": 96109
 },
 {
  "model": "SP 72/12",
  "casing": "8\"",
  "hp": 60,
  "outlet": "5\"",
  "flowM3h": 72,
  "headM": 162,
  "price": 96109
 },
 {
  "model": "SP 72/12",
  "casing": "8\"",
  "hp": 60,
  "outlet": "5\"",
  "flowM3h": 78,
  "headM": 151,
  "price": 96109
 },
 {
  "model": "SP 72/12",
  "casing": "8\"",
  "hp": 60,
  "outlet": "5\"",
  "flowM3h": 84,
  "headM": 138,
  "price": 96109
 },
 {
  "model": "SP 72/14",
  "casing": "8\"",
  "hp": 70,
  "outlet": "5\"",
  "flowM3h": 66,
  "headM": 200,
  "price": 110224
 },
 {
  "model": "SP 72/14",
  "casing": "8\"",
  "hp": 70,
  "outlet": "5\"",
  "flowM3h": 72,
  "headM": 189,
  "price": 110224
 },
 {
  "model": "SP 72/14",
  "casing": "8\"",
  "hp": 70,
  "outlet": "5\"",
  "flowM3h": 78,
  "headM": 176,
  "price": 110224
 },
 {
  "model": "SP 72/14",
  "casing": "8\"",
  "hp": 70,
  "outlet": "5\"",
  "flowM3h": 84,
  "headM": 161,
  "price": 110224
 },
 {
  "model": "SP 72/15",
  "casing": "8\"",
  "hp": 75,
  "outlet": "5\"",
  "flowM3h": 66,
  "headM": 214,
  "price": 116957
 },
 {
  "model": "SP 72/15",
  "casing": "8\"",
  "hp": 75,
  "outlet": "5\"",
  "flowM3h": 72,
  "headM": 202,
  "price": 116957
 },
 {
  "model": "SP 72/15",
  "casing": "8\"",
  "hp": 75,
  "outlet": "5\"",
  "flowM3h": 78,
  "headM": 189,
  "price": 116957
 },
 {
  "model": "SP 72/15",
  "casing": "8\"",
  "hp": 75,
  "outlet": "5\"",
  "flowM3h": 84,
  "headM": 172,
  "price": 116957
 },
 {
  "model": "SP 72/18",
  "casing": "8\"",
  "hp": 85,
  "outlet": "5\"",
  "flowM3h": 66,
  "headM": 257,
  "price": 135660
 },
 {
  "model": "SP 72/18",
  "casing": "8\"",
  "hp": 85,
  "outlet": "5\"",
  "flowM3h": 72,
  "headM": 243,
  "price": 135660
 },
 {
  "model": "SP 72/18",
  "casing": "8\"",
  "hp": 85,
  "outlet": "5\"",
  "flowM3h": 78,
  "headM": 226,
  "price": 135660
 },
 {
  "model": "SP 72/18",
  "casing": "8\"",
  "hp": 85,
  "outlet": "5\"",
  "flowM3h": 84,
  "headM": 207,
  "price": 135660
 },
 {
  "model": "SP 72/20",
  "casing": "8\"",
  "hp": 100,
  "outlet": "5\"",
  "flowM3h": 66,
  "headM": 285,
  "price": 142942
 },
 {
  "model": "SP 72/20",
  "casing": "8\"",
  "hp": 100,
  "outlet": "5\"",
  "flowM3h": 72,
  "headM": 269,
  "price": 142942
 },
 {
  "model": "SP 72/20",
  "casing": "8\"",
  "hp": 100,
  "outlet": "5\"",
  "flowM3h": 78,
  "headM": 251,
  "price": 142942
 },
 {
  "model": "SP 72/20",
  "casing": "8\"",
  "hp": 100,
  "outlet": "5\"",
  "flowM3h": 84,
  "headM": 230,
  "price": 142942
 },
 {
  "model": "SP 72/22",
  "casing": "8\"",
  "hp": 110,
  "outlet": "5\"",
  "flowM3h": 66,
  "headM": 314,
  "price": 150323
 },
 {
  "model": "SP 72/22",
  "casing": "8\"",
  "hp": 110,
  "outlet": "5\"",
  "flowM3h": 72,
  "headM": 296,
  "price": 150323
 },
 {
  "model": "SP 72/22",
  "casing": "8\"",
  "hp": 110,
  "outlet": "5\"",
  "flowM3h": 78,
  "headM": 276,
  "price": 150323
 },
 {
  "model": "SP 72/22",
  "casing": "8\"",
  "hp": 110,
  "outlet": "5\"",
  "flowM3h": 84,
  "headM": 253,
  "price": 150323
 },
 {
  "model": "SP 96/02",
  "casing": "6\"",
  "hp": 15,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 35,
  "price": 43652
 },
 {
  "model": "SP 96/02",
  "casing": "6\"",
  "hp": 15,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 33,
  "price": 43652
 },
 {
  "model": "SP 96/02",
  "casing": "6\"",
  "hp": 15,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 31,
  "price": 43652
 },
 {
  "model": "SP 96/02",
  "casing": "6\"",
  "hp": 15,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 27,
  "price": 43652
 },
 {
  "model": "SP 96/03A",
  "casing": "6\"",
  "hp": 20,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 44,
  "price": 45885
 },
 {
  "model": "SP 96/03A",
  "casing": "6\"",
  "hp": 20,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 41,
  "price": 45885
 },
 {
  "model": "SP 96/03A",
  "casing": "6\"",
  "hp": 20,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 39,
  "price": 45885
 },
 {
  "model": "SP 96/03A",
  "casing": "6\"",
  "hp": 20,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 34,
  "price": 45885
 },
 {
  "model": "SP 96/03",
  "casing": "6\"",
  "hp": 25,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 52,
  "price": 45885
 },
 {
  "model": "SP 96/03",
  "casing": "6\"",
  "hp": 25,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 49,
  "price": 45885
 },
 {
  "model": "SP 96/03",
  "casing": "6\"",
  "hp": 25,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 46,
  "price": 45885
 },
 {
  "model": "SP 96/03",
  "casing": "6\"",
  "hp": 25,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 41,
  "price": 45885
 },
 {
  "model": "SP 96/04",
  "casing": "6\"",
  "hp": 30,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 69,
  "price": 52020
 },
 {
  "model": "SP 96/04",
  "casing": "6\"",
  "hp": 30,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 66,
  "price": 52020
 },
 {
  "model": "SP 96/04",
  "casing": "6\"",
  "hp": 30,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 61,
  "price": 52020
 },
 {
  "model": "SP 96/04",
  "casing": "6\"",
  "hp": 30,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 55,
  "price": 52020
 },
 {
  "model": "SP 96/05",
  "casing": "6\"",
  "hp": 40,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 86,
  "price": 57157
 },
 {
  "model": "SP 96/05",
  "casing": "6\"",
  "hp": 40,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 82,
  "price": 57157
 },
 {
  "model": "SP 96/05",
  "casing": "6\"",
  "hp": 40,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 76,
  "price": 57157
 },
 {
  "model": "SP 96/05",
  "casing": "6\"",
  "hp": 40,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 69,
  "price": 57157
 },
 {
  "model": "SP 96/06",
  "casing": "6-8\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 104,
  "price": 62244
 },
 {
  "model": "SP 96/06",
  "casing": "6-8\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 98,
  "price": 62244
 },
 {
  "model": "SP 96/06",
  "casing": "6-8\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 92,
  "price": 62244
 },
 {
  "model": "SP 96/06",
  "casing": "6-8\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 82,
  "price": 62244
 },
 {
  "model": "SP 96/07",
  "casing": "6-8\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 121,
  "price": 67830
 },
 {
  "model": "SP 96/07",
  "casing": "6-8\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 115,
  "price": 67830
 },
 {
  "model": "SP 96/07",
  "casing": "6-8\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 107,
  "price": 67830
 },
 {
  "model": "SP 96/07",
  "casing": "6-8\"",
  "hp": 50,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 96,
  "price": 67830
 },
 {
  "model": "SP 96/08",
  "casing": "8\"",
  "hp": 60,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 138,
  "price": 74613
 },
 {
  "model": "SP 96/08",
  "casing": "8\"",
  "hp": 60,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 131,
  "price": 74613
 },
 {
  "model": "SP 96/08",
  "casing": "8\"",
  "hp": 60,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 122,
  "price": 74613
 },
 {
  "model": "SP 96/08",
  "casing": "8\"",
  "hp": 60,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 110,
  "price": 74613
 },
 {
  "model": "SP 96/09",
  "casing": "8\"",
  "hp": 75,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 156,
  "price": 80299
 },
 {
  "model": "SP 96/09",
  "casing": "8\"",
  "hp": 75,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 148,
  "price": 80299
 },
 {
  "model": "SP 96/09",
  "casing": "8\"",
  "hp": 75,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 137,
  "price": 80299
 },
 {
  "model": "SP 96/09",
  "casing": "8\"",
  "hp": 75,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 123,
  "price": 80299
 },
 {
  "model": "SP 96/10",
  "casing": "8\"",
  "hp": 75,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 173,
  "price": 87581
 },
 {
  "model": "SP 96/10",
  "casing": "8\"",
  "hp": 75,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 164,
  "price": 87581
 },
 {
  "model": "SP 96/10",
  "casing": "8\"",
  "hp": 75,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 153,
  "price": 87581
 },
 {
  "model": "SP 96/10",
  "casing": "8\"",
  "hp": 75,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 137,
  "price": 87581
 },
 {
  "model": "SP 96/11A",
  "casing": "8\"",
  "hp": 80,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 190,
  "price": 92768
 },
 {
  "model": "SP 96/11A",
  "casing": "8\"",
  "hp": 80,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 181,
  "price": 92768
 },
 {
  "model": "SP 96/11A",
  "casing": "8\"",
  "hp": 80,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 168,
  "price": 92768
 },
 {
  "model": "SP 96/11A",
  "casing": "8\"",
  "hp": 80,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 151,
  "price": 92768
 },
 {
  "model": "SP 96/12",
  "casing": "8\"",
  "hp": 85,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 207,
  "price": 97755
 },
 {
  "model": "SP 96/12",
  "casing": "8\"",
  "hp": 85,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 197,
  "price": 97755
 },
 {
  "model": "SP 96/12",
  "casing": "8\"",
  "hp": 85,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 183,
  "price": 97755
 },
 {
  "model": "SP 96/12",
  "casing": "8\"",
  "hp": 85,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 165,
  "price": 97755
 },
 {
  "model": "SP 96/13",
  "casing": "8\"",
  "hp": 100,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 225,
  "price": 103989
 },
 {
  "model": "SP 96/13",
  "casing": "8\"",
  "hp": 100,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 213,
  "price": 103989
 },
 {
  "model": "SP 96/13",
  "casing": "8\"",
  "hp": 100,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 198,
  "price": 103989
 },
 {
  "model": "SP 96/13",
  "casing": "8\"",
  "hp": 100,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 178,
  "price": 103989
 },
 {
  "model": "SP 96/14",
  "casing": "8\"",
  "hp": 100,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 242,
  "price": 111122
 },
 {
  "model": "SP 96/14",
  "casing": "8\"",
  "hp": 100,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 230,
  "price": 111122
 },
 {
  "model": "SP 96/14",
  "casing": "8\"",
  "hp": 100,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 214,
  "price": 111122
 },
 {
  "model": "SP 96/14",
  "casing": "8\"",
  "hp": 100,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 192,
  "price": 111122
 },
 {
  "model": "SP 96/15",
  "casing": "8\"",
  "hp": 110,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 259,
  "price": 115580
 },
 {
  "model": "SP 96/15",
  "casing": "8\"",
  "hp": 110,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 246,
  "price": 115580
 },
 {
  "model": "SP 96/15",
  "casing": "8\"",
  "hp": 110,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 229,
  "price": 115580
 },
 {
  "model": "SP 96/15",
  "casing": "8\"",
  "hp": 110,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 206,
  "price": 115580
 },
 {
  "model": "SP 96/16",
  "casing": "8\"",
  "hp": 125,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 277,
  "price": 122094
 },
 {
  "model": "SP 96/16",
  "casing": "8\"",
  "hp": 125,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 263,
  "price": 122094
 },
 {
  "model": "SP 96/16",
  "casing": "8\"",
  "hp": 125,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 244,
  "price": 122094
 },
 {
  "model": "SP 96/16",
  "casing": "8\"",
  "hp": 125,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 219,
  "price": 122094
 },
 {
  "model": "SP 96/18",
  "casing": "8\"",
  "hp": 150,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 311,
  "price": 133865
 },
 {
  "model": "SP 96/18",
  "casing": "8\"",
  "hp": 150,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 295,
  "price": 133865
 },
 {
  "model": "SP 96/18",
  "casing": "8\"",
  "hp": 150,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 275,
  "price": 133865
 },
 {
  "model": "SP 96/18",
  "casing": "8\"",
  "hp": 150,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 247,
  "price": 133865
 },
 {
  "model": "SP 96/20",
  "casing": "10\"",
  "hp": 150,
  "outlet": "5\"",
  "flowM3h": 80,
  "headM": 346,
  "price": 145236
 },
 {
  "model": "SP 96/20",
  "casing": "10\"",
  "hp": 150,
  "outlet": "5\"",
  "flowM3h": 88,
  "headM": 328,
  "price": 145236
 },
 {
  "model": "SP 96/20",
  "casing": "10\"",
  "hp": 150,
  "outlet": "5\"",
  "flowM3h": 96,
  "headM": 305,
  "price": 145236
 },
 {
  "model": "SP 96/20",
  "casing": "10\"",
  "hp": 150,
  "outlet": "5\"",
  "flowM3h": 104,
  "headM": 274,
  "price": 145236
 },
 {
  "model": "SP 110/02",
  "casing": "6\"",
  "hp": 20,
  "outlet": "6\"",
  "flowM3h": 100,
  "headM": 39,
  "price": 63840
 },
 {
  "model": "SP 110/02",
  "casing": "6\"",
  "hp": 20,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 36,
  "price": 63840
 },
 {
  "model": "SP 110/02",
  "casing": "6\"",
  "hp": 20,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 33,
  "price": 63840
 },
 {
  "model": "SP 110/02",
  "casing": "6\"",
  "hp": 20,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 29,
  "price": 63840
 },
 {
  "model": "SP 110/03",
  "casing": "6\"",
  "hp": 30,
  "outlet": "6\"",
  "flowM3h": 100,
  "headM": 58,
  "price": 72369
 },
 {
  "model": "SP 110/03",
  "casing": "6\"",
  "hp": 30,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 54,
  "price": 72369
 },
 {
  "model": "SP 110/03",
  "casing": "6\"",
  "hp": 30,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 49,
  "price": 72369
 },
 {
  "model": "SP 110/03",
  "casing": "6\"",
  "hp": 30,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 43,
  "price": 72369
 },
 {
  "model": "SP 110/04",
  "casing": "6\"",
  "hp": 40,
  "outlet": "6\"",
  "flowM3h": 100,
  "headM": 77,
  "price": 84239
 },
 {
  "model": "SP 110/04",
  "casing": "6\"",
  "hp": 40,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 72,
  "price": 84239
 },
 {
  "model": "SP 110/04",
  "casing": "6\"",
  "hp": 40,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 65,
  "price": 84239
 },
 {
  "model": "SP 110/04",
  "casing": "6\"",
  "hp": 40,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 58,
  "price": 84239
 },
 {
  "model": "SP 110/05",
  "casing": "8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 100,
  "headM": 97,
  "price": 93865
 },
 {
  "model": "SP 110/05",
  "casing": "8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 90,
  "price": 93865
 },
 {
  "model": "SP 110/05",
  "casing": "8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 82,
  "price": 93865
 },
 {
  "model": "SP 110/05",
  "casing": "8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 72,
  "price": 93865
 },
 {
  "model": "SP 110/06",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 100,
  "headM": 116,
  "price": 102344
 },
 {
  "model": "SP 110/06",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 108,
  "price": 102344
 },
 {
  "model": "SP 110/06",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 98,
  "price": 102344
 },
 {
  "model": "SP 110/06",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 87,
  "price": 102344
 },
 {
  "model": "SP 110/07",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 100,
  "headM": 135,
  "price": 117456
 },
 {
  "model": "SP 110/07",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 126,
  "price": 117456
 },
 {
  "model": "SP 110/07",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 114,
  "price": 117456
 },
 {
  "model": "SP 110/07",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 101,
  "price": 117456
 },
 {
  "model": "SP 110/08",
  "casing": "8\"",
  "hp": 85,
  "outlet": "6\"",
  "flowM3h": 100,
  "headM": 155,
  "price": 127680
 },
 {
  "model": "SP 110/08",
  "casing": "8\"",
  "hp": 85,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 144,
  "price": 127680
 },
 {
  "model": "SP 110/08",
  "casing": "8\"",
  "hp": 85,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 131,
  "price": 127680
 },
 {
  "model": "SP 110/08",
  "casing": "8\"",
  "hp": 85,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 116,
  "price": 127680
 },
 {
  "model": "SP 110/09",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 100,
  "headM": 174,
  "price": 141150
 },
 {
  "model": "SP 110/09",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 162,
  "price": 141150
 },
 {
  "model": "SP 110/09",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 147,
  "price": 141150
 },
 {
  "model": "SP 110/09",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 130,
  "price": 141150
 },
 {
  "model": "SP 110/10",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 100,
  "headM": 193,
  "price": 151720
 },
 {
  "model": "SP 110/10",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 180,
  "price": 151720
 },
 {
  "model": "SP 110/10",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 164,
  "price": 151720
 },
 {
  "model": "SP 110/10",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 145,
  "price": 151720
 },
 {
  "model": "SP 110/11",
  "casing": "8\"",
  "hp": 110,
  "outlet": "6\"",
  "flowM3h": 100,
  "headM": 213,
  "price": 161296
 },
 {
  "model": "SP 110/11",
  "casing": "8\"",
  "hp": 110,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 198,
  "price": 161296
 },
 {
  "model": "SP 110/11",
  "casing": "8\"",
  "hp": 110,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 180,
  "price": 161296
 },
 {
  "model": "SP 110/11",
  "casing": "8\"",
  "hp": 110,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 159,
  "price": 161296
 },
 {
  "model": "SP 110/12",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 100,
  "headM": 232,
  "price": 171670
 },
 {
  "model": "SP 110/12",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 215,
  "price": 171670
 },
 {
  "model": "SP 110/12",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 196,
  "price": 171670
 },
 {
  "model": "SP 110/12",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 174,
  "price": 171670
 },
 {
  "model": "SP 110/13",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 100,
  "headM": 251,
  "price": 207895
 },
 {
  "model": "SP 110/13",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 233,
  "price": 207895
 },
 {
  "model": "SP 110/13",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 213,
  "price": 207895
 },
 {
  "model": "SP 110/13",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 188,
  "price": 207895
 },
 {
  "model": "SP 110/14",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 100,
  "headM": 271,
  "price": 217338
 },
 {
  "model": "SP 110/14",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 251,
  "price": 217338
 },
 {
  "model": "SP 110/14",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 229,
  "price": 217338
 },
 {
  "model": "SP 110/14",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 203,
  "price": 217338
 },
 {
  "model": "SP 110/15",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 100,
  "headM": 290,
  "price": 228994
 },
 {
  "model": "SP 110/15",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 269,
  "price": 228994
 },
 {
  "model": "SP 110/15",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 245,
  "price": 228994
 },
 {
  "model": "SP 110/15",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 217,
  "price": 228994
 },
 {
  "model": "SP 120/02A",
  "casing": "6\"",
  "hp": 25,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 34,
  "price": 66533
 },
 {
  "model": "SP 120/02A",
  "casing": "6\"",
  "hp": 25,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 33,
  "price": 66533
 },
 {
  "model": "SP 120/02A",
  "casing": "6\"",
  "hp": 25,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 32,
  "price": 66533
 },
 {
  "model": "SP 120/02A",
  "casing": "6\"",
  "hp": 25,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 30,
  "price": 66533
 },
 {
  "model": "SP 120/02",
  "casing": "6\"",
  "hp": 35,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 46,
  "price": 66533
 },
 {
  "model": "SP 120/02",
  "casing": "6\"",
  "hp": 35,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 44,
  "price": 66533
 },
 {
  "model": "SP 120/02",
  "casing": "6\"",
  "hp": 35,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 42,
  "price": 66533
 },
 {
  "model": "SP 120/02",
  "casing": "6\"",
  "hp": 35,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 39,
  "price": 66533
 },
 {
  "model": "SP 120/03A",
  "casing": "6\"",
  "hp": 30,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 58,
  "price": 75361
 },
 {
  "model": "SP 120/03A",
  "casing": "6\"",
  "hp": 30,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 56,
  "price": 75361
 },
 {
  "model": "SP 120/03A",
  "casing": "6\"",
  "hp": 30,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 52,
  "price": 75361
 },
 {
  "model": "SP 120/03A",
  "casing": "6\"",
  "hp": 30,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 49,
  "price": 75361
 },
 {
  "model": "SP 120/03",
  "casing": "6\"",
  "hp": 40,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 69,
  "price": 75361
 },
 {
  "model": "SP 120/03",
  "casing": "6\"",
  "hp": 40,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 66,
  "price": 75361
 },
 {
  "model": "SP 120/03",
  "casing": "6\"",
  "hp": 40,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 63,
  "price": 75361
 },
 {
  "model": "SP 120/03",
  "casing": "6\"",
  "hp": 40,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 59,
  "price": 75361
 },
 {
  "model": "SP 120/04A",
  "casing": "8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 81,
  "price": 87730
 },
 {
  "model": "SP 120/04A",
  "casing": "8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 77,
  "price": 87730
 },
 {
  "model": "SP 120/04A",
  "casing": "8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 74,
  "price": 87730
 },
 {
  "model": "SP 120/04A",
  "casing": "8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 69,
  "price": 87730
 },
 {
  "model": "SP 120/04",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 93,
  "price": 87730
 },
 {
  "model": "SP 120/04",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 88,
  "price": 87730
 },
 {
  "model": "SP 120/04",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 84,
  "price": 87730
 },
 {
  "model": "SP 120/04",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 78,
  "price": 87730
 },
 {
  "model": "SP 120/05A",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 105,
  "price": 97755
 },
 {
  "model": "SP 120/05A",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 100,
  "price": 97755
 },
 {
  "model": "SP 120/05A",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 95,
  "price": 97755
 },
 {
  "model": "SP 120/05A",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 88,
  "price": 97755
 },
 {
  "model": "SP 120/05",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 116,
  "price": 97755
 },
 {
  "model": "SP 120/05",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 111,
  "price": 97755
 },
 {
  "model": "SP 120/05",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 105,
  "price": 97755
 },
 {
  "model": "SP 120/05",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 98,
  "price": 97755
 },
 {
  "model": "SP 120/06",
  "casing": "8\"",
  "hp": 85,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 139,
  "price": 110898
 },
 {
  "model": "SP 120/06",
  "casing": "8\"",
  "hp": 85,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 133,
  "price": 110898
 },
 {
  "model": "SP 120/06",
  "casing": "8\"",
  "hp": 85,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 126,
  "price": 110898
 },
 {
  "model": "SP 120/06",
  "casing": "8\"",
  "hp": 85,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 117,
  "price": 110898
 },
 {
  "model": "SP 120/07",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 162,
  "price": 122343
 },
 {
  "model": "SP 120/07",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 155,
  "price": 122343
 },
 {
  "model": "SP 120/07",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 146,
  "price": 122343
 },
 {
  "model": "SP 120/07",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 137,
  "price": 122343
 },
 {
  "model": "SP 120/08",
  "casing": "8\"",
  "hp": 110,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 185,
  "price": 133067
 },
 {
  "model": "SP 120/08",
  "casing": "8\"",
  "hp": 110,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 177,
  "price": 133067
 },
 {
  "model": "SP 120/08",
  "casing": "8\"",
  "hp": 110,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 167,
  "price": 133067
 },
 {
  "model": "SP 120/08",
  "casing": "8\"",
  "hp": 110,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 156,
  "price": 133067
 },
 {
  "model": "SP 120/09",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 208,
  "price": 146283
 },
 {
  "model": "SP 120/09",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 199,
  "price": 146283
 },
 {
  "model": "SP 120/09",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 188,
  "price": 146283
 },
 {
  "model": "SP 120/09",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 176,
  "price": 146283
 },
 {
  "model": "SP 120/10",
  "casing": "8\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 232,
  "price": 158004
 },
 {
  "model": "SP 120/10",
  "casing": "8\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 221,
  "price": 158004
 },
 {
  "model": "SP 120/10",
  "casing": "8\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 209,
  "price": 158004
 },
 {
  "model": "SP 120/10",
  "casing": "8\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 195,
  "price": 158004
 },
 {
  "model": "SP 120/11",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 110,
  "headM": 255,
  "price": 168029
 },
 {
  "model": "SP 120/11",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 120,
  "headM": 243,
  "price": 168029
 },
 {
  "model": "SP 120/11",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 130,
  "headM": 230,
  "price": 168029
 },
 {
  "model": "SP 120/11",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 215,
  "price": 168029
 },
 {
  "model": "SP 160/02AA",
  "casing": "6\"",
  "hp": 25,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 26,
  "price": 70673
 },
 {
  "model": "SP 160/02AA",
  "casing": "6\"",
  "hp": 25,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 25,
  "price": 70673
 },
 {
  "model": "SP 160/02AA",
  "casing": "6\"",
  "hp": 25,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 24,
  "price": 70673
 },
 {
  "model": "SP 160/02AA",
  "casing": "6\"",
  "hp": 25,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 23,
  "price": 70673
 },
 {
  "model": "SP 160/02A",
  "casing": "6\"",
  "hp": 30,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 34,
  "price": 70673
 },
 {
  "model": "SP 160/02A",
  "casing": "6\"",
  "hp": 30,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 33,
  "price": 70673
 },
 {
  "model": "SP 160/02A",
  "casing": "6\"",
  "hp": 30,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 31,
  "price": 70673
 },
 {
  "model": "SP 160/02A",
  "casing": "6\"",
  "hp": 30,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 29,
  "price": 70673
 },
 {
  "model": "SP 160/02",
  "casing": "6\"",
  "hp": 35,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 42,
  "price": 70673
 },
 {
  "model": "SP 160/02",
  "casing": "6\"",
  "hp": 35,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 40,
  "price": 70673
 },
 {
  "model": "SP 160/02",
  "casing": "6\"",
  "hp": 35,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 38,
  "price": 70673
 },
 {
  "model": "SP 160/02",
  "casing": "6\"",
  "hp": 35,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 35,
  "price": 70673
 },
 {
  "model": "SP 160/03A",
  "casing": "6\"",
  "hp": 40,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 53,
  "price": 78902
 },
 {
  "model": "SP 160/03A",
  "casing": "6\"",
  "hp": 40,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 50,
  "price": 78902
 },
 {
  "model": "SP 160/03A",
  "casing": "6\"",
  "hp": 40,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 47,
  "price": 78902
 },
 {
  "model": "SP 160/03A",
  "casing": "6\"",
  "hp": 40,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 44,
  "price": 78902
 },
 {
  "model": "SP 160/03",
  "casing": "6-8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 63,
  "price": 78902
 },
 {
  "model": "SP 160/03",
  "casing": "6-8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 59,
  "price": 78902
 },
 {
  "model": "SP 160/03",
  "casing": "6-8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 56,
  "price": 78902
 },
 {
  "model": "SP 160/03",
  "casing": "6-8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 53,
  "price": 78902
 },
 {
  "model": "SP 160/04A",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 74,
  "price": 91770
 },
 {
  "model": "SP 160/04A",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 69,
  "price": 91770
 },
 {
  "model": "SP 160/04A",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 66,
  "price": 91770
 },
 {
  "model": "SP 160/04A",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 62,
  "price": 91770
 },
 {
  "model": "SP 160/04",
  "casing": "8\"",
  "hp": 70,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 84,
  "price": 91770
 },
 {
  "model": "SP 160/04",
  "casing": "8\"",
  "hp": 70,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 79,
  "price": 91770
 },
 {
  "model": "SP 160/04",
  "casing": "8\"",
  "hp": 70,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 75,
  "price": 91770
 },
 {
  "model": "SP 160/04",
  "casing": "8\"",
  "hp": 70,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 71,
  "price": 91770
 },
 {
  "model": "SP 160/05A",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 93,
  "price": 103989
 },
 {
  "model": "SP 160/05A",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 89,
  "price": 103989
 },
 {
  "model": "SP 160/05A",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 85,
  "price": 103989
 },
 {
  "model": "SP 160/05A",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 80,
  "price": 103989
 },
 {
  "model": "SP 160/05",
  "casing": "8\"",
  "hp": 80,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 102,
  "price": 103989
 },
 {
  "model": "SP 160/05",
  "casing": "8\"",
  "hp": 80,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 99,
  "price": 103989
 },
 {
  "model": "SP 160/05",
  "casing": "8\"",
  "hp": 80,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 94,
  "price": 103989
 },
 {
  "model": "SP 160/05",
  "casing": "8\"",
  "hp": 80,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 89,
  "price": 103989
 },
 {
  "model": "SP 160/06A",
  "casing": "8\"",
  "hp": 90,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 114,
  "price": 113266
 },
 {
  "model": "SP 160/06A",
  "casing": "8\"",
  "hp": 90,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 109,
  "price": 113266
 },
 {
  "model": "SP 160/06A",
  "casing": "8\"",
  "hp": 90,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 104,
  "price": 113266
 },
 {
  "model": "SP 160/06A",
  "casing": "8\"",
  "hp": 90,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 97,
  "price": 113266
 },
 {
  "model": "SP 160/06",
  "casing": "8\"",
  "hp": 95,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 126,
  "price": 113266
 },
 {
  "model": "SP 160/06",
  "casing": "8\"",
  "hp": 95,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 119,
  "price": 113266
 },
 {
  "model": "SP 160/06",
  "casing": "8\"",
  "hp": 95,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 113,
  "price": 113266
 },
 {
  "model": "SP 160/06",
  "casing": "8\"",
  "hp": 95,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 106,
  "price": 113266
 },
 {
  "model": "SP 160/07A",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 134,
  "price": 130074
 },
 {
  "model": "SP 160/07A",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 129,
  "price": 130074
 },
 {
  "model": "SP 160/07A",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 122,
  "price": 130074
 },
 {
  "model": "SP 160/07A",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 115,
  "price": 130074
 },
 {
  "model": "SP 160/07",
  "casing": "8\"",
  "hp": 110,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 148,
  "price": 130074
 },
 {
  "model": "SP 160/07",
  "casing": "8\"",
  "hp": 110,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 139,
  "price": 130074
 },
 {
  "model": "SP 160/07",
  "casing": "8\"",
  "hp": 110,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 132,
  "price": 130074
 },
 {
  "model": "SP 160/07",
  "casing": "8\"",
  "hp": 110,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 124,
  "price": 130074
 },
 {
  "model": "SP 160/08",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 169,
  "price": 143640
 },
 {
  "model": "SP 160/08",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 159,
  "price": 143640
 },
 {
  "model": "SP 160/08",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 151,
  "price": 143640
 },
 {
  "model": "SP 160/08",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 142,
  "price": 143640
 },
 {
  "model": "SP 160/09",
  "casing": "8\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 190,
  "price": 155261
 },
 {
  "model": "SP 160/09",
  "casing": "8\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 178,
  "price": 155261
 },
 {
  "model": "SP 160/09",
  "casing": "8\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 169,
  "price": 155261
 },
 {
  "model": "SP 160/09",
  "casing": "8\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 160,
  "price": 155261
 },
 {
  "model": "SP 160/10",
  "casing": "10\"",
  "hp": 175,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 211,
  "price": 167780
 },
 {
  "model": "SP 160/10",
  "casing": "10\"",
  "hp": 175,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 198,
  "price": 167780
 },
 {
  "model": "SP 160/10",
  "casing": "10\"",
  "hp": 175,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 188,
  "price": 167780
 },
 {
  "model": "SP 160/10",
  "casing": "10\"",
  "hp": 175,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 177,
  "price": 167780
 },
 {
  "model": "SP 160/11",
  "casing": "10\"",
  "hp": 175,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 232,
  "price": 178353
 },
 {
  "model": "SP 160/11",
  "casing": "10\"",
  "hp": 175,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 218,
  "price": 178353
 },
 {
  "model": "SP 160/11",
  "casing": "10\"",
  "hp": 175,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 206,
  "price": 178353
 },
 {
  "model": "SP 160/11",
  "casing": "10\"",
  "hp": 175,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 195,
  "price": 178353
 },
 {
  "model": "SP 160/12",
  "casing": "10\"",
  "hp": 200,
  "outlet": "6\"",
  "flowM3h": 140,
  "headM": 253,
  "price": 198360
 },
 {
  "model": "SP 160/12",
  "casing": "10\"",
  "hp": 200,
  "outlet": "6\"",
  "flowM3h": 160,
  "headM": 238,
  "price": 198360
 },
 {
  "model": "SP 160/12",
  "casing": "10\"",
  "hp": 200,
  "outlet": "6\"",
  "flowM3h": 170,
  "headM": 225,
  "price": 198360
 },
 {
  "model": "SP 160/12",
  "casing": "10\"",
  "hp": 200,
  "outlet": "6\"",
  "flowM3h": 180,
  "headM": 213,
  "price": 198360
 },
 {
  "model": "SP 210/02",
  "casing": "8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 210,
  "headM": 46,
  "price": 135211
 },
 {
  "model": "SP 210/02",
  "casing": "8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 220,
  "headM": 44,
  "price": 135211
 },
 {
  "model": "SP 210/02",
  "casing": "8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 230,
  "headM": 42,
  "price": 135211
 },
 {
  "model": "SP 210/02",
  "casing": "8\"",
  "hp": 50,
  "outlet": "6\"",
  "flowM3h": 250,
  "headM": 37,
  "price": 135211
 },
 {
  "model": "SP 210/03A",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 210,
  "headM": 57,
  "price": 153815
 },
 {
  "model": "SP 210/03A",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 220,
  "headM": 55,
  "price": 153815
 },
 {
  "model": "SP 210/03A",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 230,
  "headM": 53,
  "price": 153815
 },
 {
  "model": "SP 210/03A",
  "casing": "8\"",
  "hp": 60,
  "outlet": "6\"",
  "flowM3h": 250,
  "headM": 47,
  "price": 153815
 },
 {
  "model": "SP 210/03",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 210,
  "headM": 68,
  "price": 153815
 },
 {
  "model": "SP 210/03",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 220,
  "headM": 66,
  "price": 153815
 },
 {
  "model": "SP 210/03",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 230,
  "headM": 63,
  "price": 153815
 },
 {
  "model": "SP 210/03",
  "casing": "8\"",
  "hp": 75,
  "outlet": "6\"",
  "flowM3h": 250,
  "headM": 56,
  "price": 153815
 },
 {
  "model": "SP 210/04A",
  "casing": "8\"",
  "hp": 90,
  "outlet": "6\"",
  "flowM3h": 210,
  "headM": 80,
  "price": 172568
 },
 {
  "model": "SP 210/04A",
  "casing": "8\"",
  "hp": 90,
  "outlet": "6\"",
  "flowM3h": 220,
  "headM": 77,
  "price": 172568
 },
 {
  "model": "SP 210/04A",
  "casing": "8\"",
  "hp": 90,
  "outlet": "6\"",
  "flowM3h": 230,
  "headM": 74,
  "price": 172568
 },
 {
  "model": "SP 210/04A",
  "casing": "8\"",
  "hp": 90,
  "outlet": "6\"",
  "flowM3h": 250,
  "headM": 65,
  "price": 172568
 },
 {
  "model": "SP 210/04",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 210,
  "headM": 91,
  "price": 172568
 },
 {
  "model": "SP 210/04",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 220,
  "headM": 88,
  "price": 172568
 },
 {
  "model": "SP 210/04",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 230,
  "headM": 84,
  "price": 172568
 },
 {
  "model": "SP 210/04",
  "casing": "8\"",
  "hp": 100,
  "outlet": "6\"",
  "flowM3h": 250,
  "headM": 74,
  "price": 172568
 },
 {
  "model": "SP 210/05",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 210,
  "headM": 114,
  "price": 191321
 },
 {
  "model": "SP 210/05",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 220,
  "headM": 110,
  "price": 191321
 },
 {
  "model": "SP 210/05",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 230,
  "headM": 105,
  "price": 191321
 },
 {
  "model": "SP 210/05",
  "casing": "8\"",
  "hp": 125,
  "outlet": "6\"",
  "flowM3h": 250,
  "headM": 93,
  "price": 191321
 },
 {
  "model": "SP 210/06",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 210,
  "headM": 137,
  "price": 212069
 },
 {
  "model": "SP 210/06",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 220,
  "headM": 132,
  "price": 212069
 },
 {
  "model": "SP 210/06",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 230,
  "headM": 126,
  "price": 212069
 },
 {
  "model": "SP 210/06",
  "casing": "10\"",
  "hp": 150,
  "outlet": "6\"",
  "flowM3h": 250,
  "headM": 111,
  "price": 212069
 },
 {
  "model": "SP 210/07",
  "casing": "10\"",
  "hp": 175,
  "outlet": "6\"",
  "flowM3h": 210,
  "headM": 159,
  "price": 232767
 },
 {
  "model": "SP 210/07",
  "casing": "10\"",
  "hp": 175,
  "outlet": "6\"",
  "flowM3h": 220,
  "headM": 153,
  "price": 232767
 },
 {
  "model": "SP 210/07",
  "casing": "10\"",
  "hp": 175,
  "outlet": "6\"",
  "flowM3h": 230,
  "headM": 146,
  "price": 232767
 },
 {
  "model": "SP 210/07",
  "casing": "10\"",
  "hp": 175,
  "outlet": "6\"",
  "flowM3h": 250,
  "headM": 130,
  "price": 232767
 },
 {
  "model": "SP 210/08",
  "casing": "10\"",
  "hp": 200,
  "outlet": "6\"",
  "flowM3h": 210,
  "headM": 182,
  "price": 284736
 },
 {
  "model": "SP 210/08",
  "casing": "10\"",
  "hp": 200,
  "outlet": "6\"",
  "flowM3h": 220,
  "headM": 175,
  "price": 284736
 },
 {
  "model": "SP 210/08",
  "casing": "10\"",
  "hp": 200,
  "outlet": "6\"",
  "flowM3h": 230,
  "headM": 167,
  "price": 284736
 },
 {
  "model": "SP 210/08",
  "casing": "10\"",
  "hp": 200,
  "outlet": "6\"",
  "flowM3h": 250,
  "headM": 148,
  "price": 284736
 },
 {
  "model": "SP 210/09",
  "casing": "10\"",
  "hp": 225,
  "outlet": "6\"",
  "flowM3h": 210,
  "headM": 205,
  "price": 306233
 },
 {
  "model": "SP 210/09",
  "casing": "10\"",
  "hp": 225,
  "outlet": "6\"",
  "flowM3h": 220,
  "headM": 197,
  "price": 306233
 },
 {
  "model": "SP 210/09",
  "casing": "10\"",
  "hp": 225,
  "outlet": "6\"",
  "flowM3h": 230,
  "headM": 188,
  "price": 306233
 },
 {
  "model": "SP 210/09",
  "casing": "10\"",
  "hp": 225,
  "outlet": "6\"",
  "flowM3h": 250,
  "headM": 167,
  "price": 306233
 }
];

const MOTORS = [
 {
  "model": "FM-6",
  "kw": 4,
  "casing": 6,
  "castIronPrice": 37917,
  "stStPrice": 49743,
  "hp": 6
 },
 {
  "model": "FM-7.5",
  "kw": 5.5,
  "casing": 6,
  "castIronPrice": 39216,
  "stStPrice": 51777,
  "hp": 7.5
 },
 {
  "model": "FM-10",
  "kw": 7.5,
  "casing": 6,
  "castIronPrice": 44118,
  "stStPrice": 54141,
  "hp": 10
 },
 {
  "model": "FM-15",
  "kw": 11,
  "casing": 6,
  "castIronPrice": 51409,
  "stStPrice": 61931,
  "hp": 15
 },
 {
  "model": "FM-20",
  "kw": 15,
  "casing": 6,
  "castIronPrice": 63725,
  "stStPrice": 73775,
  "hp": 20
 },
 {
  "model": "FM-25",
  "kw": 18.5,
  "casing": 6,
  "castIronPrice": 66789,
  "stStPrice": 75997,
  "hp": 25
 },
 {
  "model": "FM-30",
  "kw": 22,
  "casing": 6,
  "castIronPrice": 81189,
  "stStPrice": 92279,
  "hp": 30
 },
 {
  "model": "FM-40",
  "kw": 30,
  "casing": 6,
  "castIronPrice": 95711,
  "stStPrice": 107659,
  "hp": 40
 },
 {
  "model": "FM-50",
  "kw": 37,
  "casing": 6,
  "castIronPrice": 99206,
  "stStPrice": 113848,
  "hp": 50
 },
 {
  "model": "FM-50",
  "kw": 37,
  "casing": 7,
  "castIronPrice": 102328,
  "stStPrice": 116789,
  "hp": 50
 },
 {
  "model": "FM-60",
  "kw": 45,
  "casing": 7,
  "castIronPrice": 107408,
  "stStPrice": 127696,
  "hp": 60
 },
 {
  "model": "FM-50",
  "kw": 37,
  "casing": 8,
  "castIronPrice": 108928,
  "stStPrice": 133625,
  "hp": 50
 },
 {
  "model": "FM-60",
  "kw": 45,
  "casing": 8,
  "castIronPrice": 113219,
  "stStPrice": 140979,
  "hp": 60
 },
 {
  "model": "FM-70",
  "kw": 50,
  "casing": 8,
  "castIronPrice": 126123,
  "stStPrice": 149877,
  "hp": 70
 },
 {
  "model": "FM-75",
  "kw": 55,
  "casing": 8,
  "castIronPrice": 131859,
  "stStPrice": 154657,
  "hp": 75
 },
 {
  "model": "FM-80",
  "kw": 60,
  "casing": 8,
  "castIronPrice": 139022,
  "stStPrice": 163235,
  "hp": 80
 },
 {
  "model": "FM-90",
  "kw": 67,
  "casing": 8,
  "castIronPrice": 144758,
  "stStPrice": 172958,
  "hp": 90
 },
 {
  "model": "FM-100",
  "kw": 75,
  "casing": 8,
  "castIronPrice": 153355,
  "stStPrice": 177883,
  "hp": 100
 },
 {
  "model": "FM-110",
  "kw": 81,
  "casing": 8,
  "castIronPrice": 166254,
  "stStPrice": 190196,
  "hp": 110
 },
 {
  "model": "FM-125",
  "kw": 92,
  "casing": 8,
  "castIronPrice": 180587,
  "stStPrice": 204902,
  "hp": 125
 },
 {
  "model": "FM-150",
  "kw": 110,
  "casing": 8,
  "castIronPrice": 196354,
  "stStPrice": 222794,
  "hp": 150
 },
 {
  "model": "FM-150",
  "kw": 110,
  "casing": 10,
  "castIronPrice": 263800,
  "stStPrice": 297279,
  "hp": 150
 },
 {
  "model": "FM-175",
  "kw": 129,
  "casing": 10,
  "castIronPrice": 285742,
  "stStPrice": 318203,
  "hp": 175
 },
 {
  "model": "FM-200",
  "kw": 147,
  "casing": 10,
  "castIronPrice": 317151,
  "stStPrice": 348154,
  "hp": 200
 }
];

module.exports = { PUMPS, MOTORS };
