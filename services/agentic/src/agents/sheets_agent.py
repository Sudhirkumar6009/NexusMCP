"""Google Sheets Agent - Handles Google Sheets/data operations."""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from .base_agent import BaseAgent
from ..gemini_client import GeminiClient

logger = logging.getLogger(__name__)


class SheetsOperation(BaseModel):
    """A Google Sheets operation to execute."""

    operation: str  # get_rows, add_row, update_row, delete_row, query_rows, list_sheets
    arguments: Dict[str, Any] = Field(default_factory=dict)
    description: str = ""
    depends_on: List[str] = Field(default_factory=list)


class SheetsWorkflowPlan(BaseModel):
    """Plan for Google Sheets operations."""

    operations: List[SheetsOperation] = Field(default_factory=list)
    extracted_params: Dict[str, str] = Field(default_factory=dict)
    summary: str = ""


class GoogleSheetsAgent(BaseAgent):
    """
    Google Sheets Agent - Specialized for spreadsheet/database style operations.

    Supported Operations:
    1. add_row
    2. get_rows
    3. update_row
    4. delete_row
    5. query_rows
    6. list_sheets
    """

    name = "google-sheets-agent"

    TOOL_MAPPINGS = {
        "get_rows": [
            "google_sheets.get_rows",
            "google_sheets.read_sheet",
            "google_sheets_read_sheet",
            "google_sheets.read_rows",
            "sheets.read_range",
            "sheets_read_range",
            "sheets.read_sheet",
            "sheets_read",
            "sheets.get_rows",
        ],
        "add_row": [
            "google_sheets.add_row",
            "google_sheets.insert_row",
            "google_sheets.append_rows",
            "google_sheets.append_row",
            "sheets.append_row",
            "sheets_append_row",
            "sheets.insert_row",
            "sheets.add_row",
        ],
        "update_row": [
            "google_sheets.update_row",
            "google_sheets.update_cells",
            "sheets.update_row",
            "sheets_update_row",
            "sheets.update_cells",
            "sheets_update_cells",
        ],
        "delete_row": [
            "google_sheets.delete_row",
            "sheets.delete_row",
            "sheets_delete_row",
        ],
        "query_rows": [
            "google_sheets.query_rows",
            "sheets.query_rows",
            "sheets_query_rows",
        ],
        "list_sheets": [
            "google_sheets.list_sheets",
            "sheets.list_sheets",
            "sheets_list_sheets",
        ],
    }

    def __init__(self, gemini: GeminiClient):
        self.gemini = gemini

    async def run(
        self,
        prompt: str,
        available_tools: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
    ) -> SheetsWorkflowPlan:
        """Analyze prompt and generate Google Sheets operations."""

        logger.info("GoogleSheetsAgent analyzing: %s...", prompt[:100])

        sheets_tools = self._filter_sheets_tools(available_tools)
        if not sheets_tools:
            logger.warning("No Google Sheets tools available")
            return SheetsWorkflowPlan(summary="No Google Sheets tools available")

        if self.gemini.enabled:
            try:
                plan = await self._llm_plan(prompt, sheets_tools, context)
                logger.info("LLM generated %s Sheets operations", len(plan.operations))
                return plan
            except Exception as exc:
                logger.warning("LLM planning failed: %s, using heuristic", exc)

        return self._heuristic_plan(prompt, sheets_tools, context)

    def _filter_sheets_tools(self, tools: Dict[str, Any]) -> Dict[str, Any]:
        """Filter to only include Google Sheets tools."""

        sheets_tools: Dict[str, Any] = {}
        for name, definition in tools.items():
            lowered = name.lower()
            if "sheet" in lowered or "spreadsheet" in lowered or "row" in lowered:
                sheets_tools[name] = definition
        return sheets_tools

    async def _llm_plan(
        self,
        prompt: str,
        tools: Dict[str, Any],
        context: Optional[Dict[str, Any]],
    ) -> SheetsWorkflowPlan:
        """Use LLM to generate a Sheets operation plan."""

        system_prompt = f"""You are a Google Sheets operations planner.

Available Google Sheets Tools:
{self._format_tools(tools)}

GOOGLE SHEETS OPERATIONS:
1. get_rows
   - Read records or ranges
   - Arguments: sheet_id, range

2. add_row
   - Insert/append a data row
   - Arguments: sheet_id, sheet_name (optional), row_data

3. update_row
   - Update existing row/range values
    - Arguments: sheet_id, row_index (or range), values

4. delete_row
    - Delete a row by index
    - Arguments: sheet_id, sheet_name (optional), row_index

5. query_rows
    - Filter rows by query/condition
    - Arguments: sheet_id, range (optional), query/filters

6. list_sheets
    - List tabs/sheets in the spreadsheet
    - Arguments: sheet_id

RULES:
1. Extract sheet id, sheet name, and A1 ranges if present
2. If request says "find/filter/query", prefer query_rows
3. If request says "read/list/fetch rows", use get_rows
4. If request says "list sheets/tabs", use list_sheets
4. Return ONLY valid JSON

OUTPUT FORMAT:
{{
  "operations": [
    {{
            "operation": "get_rows",
      "arguments": {{ "sheet_id": "abc123", "range": "A1:D50" }},
      "description": "Read data rows"
    }}
  ],
  "extracted_params": {{
    "sheet_id": "abc123"
  }},
  "summary": "Brief description"
}}"""

        context_str = ""
        if context:
            context_str = f"\nContext from previous steps: {context}"

        response = await self.gemini.generate_json(
            system_prompt,
            {"user_request": prompt + context_str},
            strict_json=True,
        )

        operations = [
            SheetsOperation(
                operation=op_data.get("operation", ""),
                arguments=op_data.get("arguments", {}),
                description=op_data.get("description", ""),
                depends_on=op_data.get("depends_on", []),
            )
            for op_data in response.get("operations", [])
        ]

        return SheetsWorkflowPlan(
            operations=operations,
            extracted_params=response.get("extracted_params", {}),
            summary=response.get("summary", ""),
        )

    def _heuristic_plan(
        self,
        prompt: str,
        tools: Dict[str, Any],
        context: Optional[Dict[str, Any]],
    ) -> SheetsWorkflowPlan:
        """Generate a Sheets plan using deterministic heuristics."""

        normalized = prompt.lower()
        operations: List[SheetsOperation] = []
        extracted_params: Dict[str, str] = {}

        sheet_id = self._extract_sheet_id(prompt)
        if sheet_id:
            extracted_params["sheet_id"] = sheet_id

        range_value = self._extract_range(prompt)
        if range_value:
            extracted_params["range"] = range_value

        sheet_name = self._extract_sheet_name(prompt)
        if sheet_name:
            extracted_params["sheet_name"] = sheet_name

        if context:
            for key in ("sheet_id", "range", "sheet_name"):
                if key in context and key not in extracted_params and isinstance(context[key], str):
                    extracted_params[key] = context[key]

        get_requested = any(
            token in normalized
            for token in ["read", "fetch", "get rows", "list rows", "query", "show"]
        )
        query_requested = any(
            token in normalized
            for token in ["query", "filter", "find", "where", "critical bugs"]
        )
        update_requested = any(
            token in normalized
            for token in ["update", "modify", "change", "edit", "set value"]
        )
        delete_requested = any(
            token in normalized
            for token in ["delete row", "remove row", "drop row"]
        )
        list_sheets_requested = any(
            token in normalized
            for token in ["list sheets", "list tabs", "sheet names", "available sheets"]
        )
        append_log_requested = any(
            token in normalized
            for token in ["append log", "audit", "log", "record event", "append audit"]
        )
        add_requested = any(
            token in normalized
            for token in ["insert", "add row", "create row", "append row", "append"]
        )

        if list_sheets_requested:
            tool_name = self._find_tool("list_sheets", tools)
            if tool_name:
                operations.append(
                    SheetsOperation(
                        operation="list_sheets",
                        arguments={
                            "sheet_id": extracted_params.get("sheet_id", ""),
                        },
                        description="List available sheets/tabs",
                    )
                )

        if query_requested:
            tool_name = self._find_tool("query_rows", tools)
            if tool_name:
                operations.append(
                    SheetsOperation(
                        operation="query_rows",
                        arguments={
                            "sheet_id": extracted_params.get("sheet_id", ""),
                            "range": extracted_params.get("range", "A1:Z100"),
                        },
                        description="Query rows from Google Sheets",
                    )
                )

        if get_requested and not query_requested:
            tool_name = self._find_tool("get_rows", tools)
            if tool_name:
                operations.append(
                    SheetsOperation(
                        operation="get_rows",
                        arguments={
                            "sheet_id": extracted_params.get("sheet_id", ""),
                            "range": extracted_params.get("range", "A1:Z100"),
                        },
                        description="Read rows from Google Sheets",
                    )
                )

        if update_requested:
            tool_name = self._find_tool("update_row", tools)
            if tool_name:
                operations.append(
                    SheetsOperation(
                        operation="update_row",
                        arguments={
                            "sheet_id": extracted_params.get("sheet_id", ""),
                            "range": extracted_params.get("range", ""),
                            "values": [],
                        },
                        description="Update Google Sheets row/range",
                    )
                )

        if delete_requested:
            tool_name = self._find_tool("delete_row", tools)
            if tool_name:
                operations.append(
                    SheetsOperation(
                        operation="delete_row",
                        arguments={
                            "sheet_id": extracted_params.get("sheet_id", ""),
                            "sheet_name": extracted_params.get("sheet_name", "Sheet1"),
                            "row_index": 2,
                        },
                        description="Delete row from Google Sheets",
                    )
                )

        if add_requested or append_log_requested:
            tool_name = self._find_tool("add_row", tools)
            if tool_name:
                operations.append(
                    SheetsOperation(
                        operation="add_row",
                        arguments={
                            "sheet_id": extracted_params.get("sheet_id", ""),
                            "sheet_name": extracted_params.get(
                                "sheet_name", "Logs" if append_log_requested else "Sheet1"
                            ),
                            "row_data": [],
                        },
                        description="Insert/append data row",
                    )
                )

        if not operations:
            fallback_tool = self._find_tool("get_rows", tools)
            if fallback_tool:
                operations.append(
                    SheetsOperation(
                        operation="get_rows",
                        arguments={
                            "sheet_id": extracted_params.get("sheet_id", ""),
                            "range": extracted_params.get("range", "A1:Z100"),
                        },
                        description="Read rows from Google Sheets",
                    )
                )

        return SheetsWorkflowPlan(
            operations=operations,
            extracted_params=extracted_params,
            summary=f"Google Sheets workflow with {len(operations)} operations",
        )

    def _extract_sheet_id(self, prompt: str) -> str:
        url_match = re.search(
            r"https?://docs\.google\.com/spreadsheets/d/([a-zA-Z0-9_-]{20,})",
            prompt,
            re.IGNORECASE,
        )
        if url_match:
            return url_match.group(1)

        patterns = [
            r"(?:sheet|spreadsheet)(?:\s+id)?\s*[:=]\s*([a-zA-Z0-9_-]{20,})",
        ]
        for pattern in patterns:
            match = re.search(pattern, prompt, re.IGNORECASE)
            candidate = match.group(1) if match else ""
            if candidate and self._is_probable_sheet_id(candidate):
                return candidate
        return ""

    def _is_probable_sheet_id(self, value: str) -> bool:
        candidate = (value or "").strip()
        if len(candidate) < 20:
            return False
        if not re.match(r"^[A-Za-z0-9_-]+$", candidate):
            return False
        if re.match(r"^[A-Z][A-Z0-9]+-\d+(?:-|$)", candidate):
            return False
        return True

    def _extract_range(self, prompt: str) -> str:
        range_match = re.search(
            r"\b([A-Za-z0-9_]+![A-Z]+\d+:[A-Z]+\d+|[A-Z]+\d+:[A-Z]+\d+)\b",
            prompt,
        )
        return range_match.group(1) if range_match else ""

    def _extract_sheet_name(self, prompt: str) -> str:
        tab_match = re.search(r"(?:sheet|tab)\s+(?:name\s+)?([A-Za-z0-9_ -]+)", prompt, re.IGNORECASE)
        if tab_match:
            value = tab_match.group(1).strip()
            if value:
                return value
        return ""

    def _find_tool(self, operation: str, tools: Dict[str, Any]) -> Optional[str]:
        candidates = self.TOOL_MAPPINGS.get(operation, [])
        for candidate in candidates:
            if candidate in tools:
                return candidate

        normalized_operation = operation.replace("_", "")
        for tool_name in tools:
            normalized_tool = tool_name.lower().replace("_", "").replace(".", "")
            if normalized_operation in normalized_tool:
                return tool_name

        return None

    def _format_tools(self, tools: Dict[str, Any]) -> str:
        import json

        formatted: Dict[str, Any] = {}
        for name, definition in tools.items():
            if hasattr(definition, "description"):
                formatted[name] = {
                    "description": definition.description,
                    "inputs": getattr(definition, "inputs", {}),
                }
            elif isinstance(definition, dict):
                formatted[name] = definition
        return json.dumps(formatted, indent=2)

    def get_tool_name(self, operation: str, available_tools: Dict[str, Any]) -> Optional[str]:
        return self._find_tool(operation, available_tools)
