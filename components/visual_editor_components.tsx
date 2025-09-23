import React, { useState, useEffect } from 'react'
import { ProjectStructure } from '../lib/code-parser'

export const VisualEditor: React.FC<{ project: ProjectStructure; onChange: (p: ProjectStructure) => void }> = ({ project: initial, onChange }) => {
  const [project, setProject] = useState<ProjectStructure>(initial)

  useEffect(() => {
    setProject(initial)
  }, [initial])

  const files = Object.keys(project.files || {})

  const updateFileContent = (path: string, value: string) => {
    const newProj = { ...project, files: { ...(project.files || {}), [path]: { content: value } } }
    setProject(newProj)
    onChange(newProj)
  }

  const addFile = () => {
    const name = `file_${Date.now()}.txt`
    const newProj = { ...project, files: { ...(project.files || {}), [name]: { content: '' } } }
    setProject(newProj)
    onChange(newProj)
  }

  const removeFile = (p: string) => {
    const newFiles = { ...(project.files || {}) }
    delete newFiles[p]
    const newProj = { ...project, files: newFiles }
    setProject(newProj)
    onChange(newProj)
  }

  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ width: 220 }}>
        <h4>Files</h4>
        <button onClick={addFile}>+ Add</button>
        <ul>
          {files.map((f) => (
            <li key={f}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{f}</span>
                <button onClick={() => removeFile(f)}>x</button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ flex: 1 }}>
        {files.length === 0 ? (
          <div>No files</div>
        ) : (
          files.map((f) => (
            <div key={f}>
              <h5>{f}</h5>
              <textarea
                value={project.files[f].content}
                onChange={(e) => updateFileContent(f, e.target.value)}
                style={{ width: '100%', height: 180 }}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}