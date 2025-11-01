import { useState, useEffect } from "react";
import axios from "axios";

function LearningPaths({ onSelectPath }) {
  const backendURL = import.meta.env.VITE_BACKEND_URL;
  const [paths, setPaths] = useState([]);

  useEffect(() => {
    const fetchPaths = async () => {
      try {
        const res = await axios.get(`${backendURL}/learning-paths`);
        setPaths(res.data);
      } catch (err) {
        console.error("Failed to fetch learning paths", err);
      }
    };
    fetchPaths();
  }, []);

  return (
    <div className="learning-paths-container">
      {paths.map((path) => (
        <div
          key={path._id}
          className="learning-path-card"
          onClick={() => onSelectPath(path)}
        >
          <img src={path.image} alt={path.title} className="learning-path-logo" />
          <h3>{path.title}</h3>
          <p>{path.description}</p>
        </div>
      ))}
    </div>
  );
}

export default LearningPaths;
