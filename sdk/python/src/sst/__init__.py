import json
import os
import inspect
import sys
from typing import Dict, Any, Type, Union
from pathlib import Path


# Define a base class for dynamic resource objects
class DynamicResource:
    def __init__(self, data: Dict[str, Any]):
        self._data = data

    def __getattr__(self, name: str) -> Any:
        if name in self._data:
            return self._data[name]
        raise AttributeError(f"Attribute '{name}' not found in resource.")

    def to_dict(self) -> Dict[str, Any]:
        return self._data


def create_resource_class(attributes: Dict[str, Type]) -> Type[DynamicResource]:
    return DynamicResource


class ResourceProxy:
    _cached_config_path = None

    def __init__(
        self, config_filename: str = "resources.json", config_path: str = None
    ):
        self._raw: Dict[str, Any] = {}
        self._resource_classes: Dict[str, Type[DynamicResource]] = {}
        if config_path:
            # If a custom path is provided, use it
            self._load_resources_from_path(config_path)
        else:
            # Otherwise, search for the default config file
            if not ResourceProxy._cached_config_path:
                ResourceProxy._cached_config_path = self._find_resources_file(
                    config_filename
                )
            self._load_resources_from_path(ResourceProxy._cached_config_path)

    def _find_resources_file(self, filename: str) -> str:
        """
        Search for the resources.json file relative to the module that imports ResourceProxy.
        """
        stack = inspect.stack()
        current_file = Path(__file__).resolve()

        # Iterate through the call stack to find the first frame outside this module
        for frame_info in stack[1:]:  # Skip the current frame
            frame_path = Path(frame_info.filename).resolve()

            # Skip frames that are part of this module/package
            if frame_path == current_file:
                continue

            # Optionally, skip other internal frames if your package has multiple modules
            # For example, if your package is named 'your_package', skip frames from it
            # Uncomment and modify the following lines if necessary:
            # if 'your_package' in frame_info.filename:
            #     continue

            # Use this frame's directory as the base path
            base_path = frame_path.parent

            # Traverse up from the base path to find the config file
            for parent in [base_path] + list(base_path.parents):
                potential_path = parent / filename
                if potential_path.is_file():
                    return str(potential_path)

            # If not found in this frame's hierarchy, continue to the next frame

        # Fallback to current working directory if not found in any frame
        cwd = Path.cwd()
        for parent in [cwd] + list(cwd.parents):
            potential_path = parent / filename
            if potential_path.is_file():
                return str(potential_path)

        raise FileNotFoundError(
            f"Configuration file '{filename}' not found relative to the importing module or in the current working directory."
        )

    def _load_resources_from_path(self, path: str):
        try:
            with open(path, "r") as f:
                resources_data = json.load(f)
        except FileNotFoundError as e:
            raise FileNotFoundError(
                f"Unable to locate configuration file at '{path}'. Please ensure it exists."
            ) from e
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in '{path}': {e}") from e

        if not isinstance(resources_data, dict):
            raise ValueError(
                f"Configuration file '{path}' must contain a JSON object at the top level."
            )

        for resource_key, data in resources_data.items():
            if isinstance(data, dict):
                # Create a resource class based on the keys in the data
                attributes = {k: type(v) for k, v in data.items()}
                self._resource_classes[resource_key] = create_resource_class(attributes)
                self._raw[resource_key] = self._resource_classes[resource_key](data)
            else:
                self._raw[resource_key] = data

    def __getattr__(self, name: str) -> Union[DynamicResource, Any]:
        if name in self._raw:
            return self._raw[name]
        raise AttributeError(f"Resource '{name}' not found.")


# Initialize the proxy object with the default configuration file name
Resource = ResourceProxy("resources.json")
