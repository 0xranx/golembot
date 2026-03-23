---
name: data-analysis
description: "Loads CSV, Excel, and JSON data files, performs statistical analysis, and generates charts and reports. Use when the user asks to analyze a dataset, compute statistics, create visualizations, find trends, or produce a data report."
---

# Data Analysis Skill

Process data files in the `data/` directory, perform analysis, and output reports to `reports/`.

## Step-by-Step Workflow

1. **Identify the data source** — List available files and confirm with the user which to analyze:

```bash
ls data/
```

2. **Load and inspect the data** — Use Python to read the file and show a summary:

```python
import pandas as pd

df = pd.read_csv("data/sales.csv")  # or read_excel / read_json
print(f"Shape: {df.shape}")
print(f"Columns: {list(df.columns)}")
print(df.dtypes)
print(df.describe())
print(f"Missing values:\n{df.isnull().sum()}")
```

3. **Clean the data** — Handle missing values, fix types, remove duplicates:

```python
df = df.drop_duplicates()
df["date"] = pd.to_datetime(df["date"], errors="coerce")
df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
df = df.dropna(subset=["date", "amount"])
print(f"Clean shape: {df.shape}")
```

4. **Analyze** — Compute the requested statistics or aggregations:

```python
# Example: monthly revenue trend
monthly = df.groupby(df["date"].dt.to_period("M"))["amount"].sum()
print(monthly)

# Example: correlation matrix
print(df[["amount", "quantity", "discount"]].corr())
```

5. **Visualize** — Generate charts and save to `reports/`:

```python
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

monthly.plot(kind="bar", title="Monthly Revenue")
plt.tight_layout()
plt.savefig("reports/monthly_revenue.png", dpi=150)
plt.close()
print("Chart saved to reports/monthly_revenue.png")
```

6. **Write the report** — Save a Markdown report to `reports/`:

```python
with open("reports/analysis_report.md", "w") as f:
    f.write("# Analysis Report\n\n")
    f.write("## Summary\n")
    f.write(f"- Total records: {len(df)}\n")
    f.write(f"- Date range: {df['date'].min()} to {df['date'].max()}\n")
    f.write(f"- Total revenue: {df['amount'].sum():,.2f}\n\n")
    f.write("## Charts\n")
    f.write("![Monthly Revenue](monthly_revenue.png)\n")
print("Report saved to reports/analysis_report.md")
```

## Validation Checkpoints

After each step, verify before proceeding:
- After loading: confirm row count and column names are plausible
- After cleaning: check that no critical data was dropped unexpectedly (compare row counts)
- After analysis: sanity-check totals and aggregations (e.g., no negative counts)
- After saving: confirm output files exist with `ls reports/`

## Using calc.py

For complex or specialized calculations, use the `calc.py` helper script:

```bash
python calc.py --input data/sales.csv --operation regression --output reports/regression.json
```

## Output Format

Analysis reports should follow this structure:

```
# [Analysis Topic] Report

## Summary
- Key finding 1
- Key finding 2

## Data Overview
- Records: N rows
- Time range: ...

## Detailed Analysis
...

## Recommendations
...
```
