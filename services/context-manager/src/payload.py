"""
Payload Transformer - Transform and route data between steps
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class TransformRule:
    """Rule for transforming payload data"""
    source_field: str
    target_field: str
    transform: Optional[Callable[[Any], Any]] = None


class PayloadTransformer:
    """
    Transforms payloads between workflow steps.
    Handles field mapping, type coercion, and custom transforms.
    """

    def __init__(self):
        self._transforms: Dict[str, List[TransformRule]] = {}

    def register_transform(
        self,
        step_id: str,
        source_field: str,
        target_field: str,
        transform: Optional[Callable[[Any], Any]] = None,
    ) -> None:
        """Register a transform rule for a step"""
        if step_id not in self._transforms:
            self._transforms[step_id] = []
        
        self._transforms[step_id].append(TransformRule(
            source_field=source_field,
            target_field=target_field,
            transform=transform,
        ))

    def transform(
        self,
        step_id: str,
        input_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Apply transforms to prepare step input.
        
        Args:
            step_id: Target step ID
            input_data: Raw input data
            
        Returns:
            Transformed data ready for step execution
        """
        rules = self._transforms.get(step_id, [])
        if not rules:
            return input_data
        
        result = {}
        for rule in rules:
            value = self._get_nested(input_data, rule.source_field)
            if value is not None:
                if rule.transform:
                    try:
                        value = rule.transform(value)
                    except Exception as e:
                        logger.warning(f"Transform failed for {rule.source_field}: {e}")
                self._set_nested(result, rule.target_field, value)
        
        return result

    def merge_outputs(
        self,
        outputs: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Merge outputs from multiple parallel steps.
        
        Args:
            outputs: List of step outputs
            
        Returns:
            Merged output dictionary
        """
        result: Dict[str, Any] = {}
        for output in outputs:
            for key, value in output.items():
                if key in result:
                    # Handle conflicts by creating lists
                    if isinstance(result[key], list):
                        result[key].append(value)
                    else:
                        result[key] = [result[key], value]
                else:
                    result[key] = value
        return result

    @staticmethod
    def _get_nested(data: Dict[str, Any], path: str) -> Any:
        """Get nested value by dot-notation path"""
        keys = path.split('.')
        value = data
        for key in keys:
            if isinstance(value, dict) and key in value:
                value = value[key]
            else:
                return None
        return value

    @staticmethod
    def _set_nested(data: Dict[str, Any], path: str, value: Any) -> None:
        """Set nested value by dot-notation path"""
        keys = path.split('.')
        for key in keys[:-1]:
            if key not in data:
                data[key] = {}
            data = data[key]
        data[keys[-1]] = value


# Common transform functions
def to_string(value: Any) -> str:
    """Convert value to string"""
    return str(value)


def to_int(value: Any) -> int:
    """Convert value to integer"""
    return int(value)


def to_list(value: Any) -> List[Any]:
    """Ensure value is a list"""
    if isinstance(value, list):
        return value
    return [value]


def extract_first(value: List[Any]) -> Any:
    """Extract first element from list"""
    return value[0] if value else None
