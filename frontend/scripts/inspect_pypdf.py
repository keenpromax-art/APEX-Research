import pypdf, os, re
d = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "samples", "research")
for f in sorted(os.listdir(d)):
    if not f.endswith(".pdf"):
        continue
    reader = pypdf.PdfReader(os.path.join(d, f))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    print(f"=== {f} ({len(reader.pages)} pages) ===")
    for needle in ["Cover", "Investment Summary", "Company Overview", "Financials", "Forecast",
                   "Valuation", "Risks", "Model Quality", "Sources", "Conclusion",
                   "SYNTHETIC DATA", "NOT FOR INVESTMENT USE"]:
        print(f"  {'OK ' if needle in text else 'MISS'} {needle}")
    # currency sanity: INR file should mention INR, not a USD$ symbol mixing
    if "inr" in f.lower():
        print(f"  INR token present: {'INR' in text}")
    # malformed tokens
    for tok in ["NaN", "undefined", "[object"]:
        if tok in text:
            print(f"  MALFORMED {tok} found!")
    print()
