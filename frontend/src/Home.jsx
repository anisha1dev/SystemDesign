import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "./Home.css";

function Home() {
  const backendURL = import.meta.env.VITE_BACKEND_URL;
  const [paths, setPaths] = useState([]);
  const navigate = useNavigate();

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

  const handlePathClick = (path) => {
    navigate(`/chat/${path._id}`);
  };

  return (
    <div className="home-container">
      <h1>Select a Learning Path</h1>
      <div className="paths-grid">
        {paths.map((path) => (
          <div
            key={path._id}
            className="path-card"
            onClick={() => handlePathClick(path)}
            style={{ cursor: "pointer" }}
          >
            <img src={path.image} alt={path.title} className="path-logo" />
            <h3>{path.title}</h3>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Home;
